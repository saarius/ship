import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createPracticeHost, validateConfig } from './runtime.mjs';
const require = createRequire(new URL('../../service/package.json', import.meta.url));
const { generateKeyPair, exportJWK, SignJWT } = require('jose');
const origin = 'https://backroadbum.com';
const keys = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'synthetic', alg: 'ES256', use: 'sig' };
const fetchJwks = async () => Response.json({ keys: [jwk] });
const config = { schema: 'backroadbum.ship-node/v1', generation: 'synthetic-generation', allowedOrderId: 'synthetic-fresh', sessionSecret: 'synthetic-secret-for-local-proof-only-not-a-deployed-key' };
const body = { schema: 'dinkuskit.commerce.ship-order/v1', orderId: config.allowedOrderId, number: 9999, version: 1, status: 'processing', test: true,
  shipTo: { name: 'Fixture', line1: '1 Example Way', city: 'Example', region: 'CA', postalCode: '90000', country: 'US' }, email: 'fixture@example.test', completed: null,
  lines: [{ catalogItemId: 'synthetic-item', name: 'Fixture mug', quantity: 1, weightOz: 8 }] };
async function pass(scope, extra = {}, audience = 'backroadbum-ship', issuer = origin) {
  return new SignJWT({ site_id: 'backroadbum', site_origin: origin, scope, ...extra })
    .setProtectedHeader({ alg: 'ES256', kid: 'synthetic' }).setIssuer(issuer).setAudience(audience)
    .setSubject('synthetic-owner').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
async function call(host, path, scope, data, extra) {
  return host.fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + await pass(scope, extra), 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
await build();
test('configuration fails closed, including accidental postage or email settings', () => {
  for (const changed of [{ ...config, allowedOrderId: undefined }, { ...config, allowedOrderId: '../order' }, { ...config, generation: '' },
    { ...config, sessionSecret: '' }, { ...config, generation: 123 }, { ...config, sessionSecret: ' '.repeat(64) }, { ...config, PB_ENVIRONMENT: 'production' }, { ...config, EMAIL: {} }, { ...config, issuer: 'https://dinkuskit.com/account' }]) {
    assert.throws(() => validateConfig(changed));
  }
});
test('closed preparation admits no orders; authentication remains scoped to this merchant and recipient', async () => {
  const host = await createPracticeHost({ config: { ...config, allowedOrderId: '' }, fetchJwks });
  try {
    assert.deepEqual(await (await host.fetch('/health')).json(), { schema: 'backroadbum.ship-health/v1', mode: 'test', provider: 'practice', admission: 'closed', commerceConnected: false });
    assert.equal((await call(host, '/v1/orders', 'ship:orders', body)).status, 403);
    assert.equal((await host.fetch('/v1/admin/orders')).status, 401);
    assert.equal((await host.fetch('/v1/admin/status')).status, 401);
    assert.equal((await call(host, '/v1/admin/status', 'ship:orders')).status, 403);
    assert.equal((await call(host, '/v1/admin/status', 'ship:admin', {})).status, 405);
    assert.deepEqual(await (await call(host, '/v1/admin/status', 'ship:admin')).json(), {
      schema: 'backroadbum.ship-admin/v1', mode: 'test', provider: 'practice', admission: 'closed', commerceConnected: false,
    });
    assert.equal((await call(host, '/v1/admin/orders', 'ship:orders')).status, 403);
    assert.equal((await call(host, '/v1/labels', 'ship:admin')).status, 403);
    for (const claims of [{ site_id: 'other-store' }, { site_origin: 'https://other.example.test' }]) {
      assert.equal((await call(host, '/v1/admin/orders', 'ship:admin', undefined, claims)).status, 403);
    }
    for (const [audience, issuer] of [['dinkus-ship', origin], ['backroadbum-payments', origin], ['backroadbum-ship', 'https://dinkuskit.com/account']]) {
      assert.equal((await host.fetch('/v1/admin/orders', { headers: { authorization: 'Bearer ' + await pass('ship:admin', {}, audience, issuer) } })).status, 401);
    }
    for (const path of ['/stores/backroadbum/settings', '/auth/callback', '/v1/tracking/pitney']) assert.equal((await host.fetch(path)).status, 404);
    assert.equal((await host.fetch('/health?recipient=legacy')).status, 400);
    const listing = await (await call(host, '/v1/admin/orders', 'ship:admin')).json();
    assert.deepEqual(listing.orders, []);
    assert.equal(listing.settings.postageConnected, false);
    assert.equal(listing.settings.testSandbox, false);
    assert.equal(host.network().refusedFetches, 0);
  } finally { await host.dispose(); }
});
test('real SQLite/workerd practice flow: intake, explicit label, PDF, restart, acknowledgement and cancellation', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'brb-ship-proof-'));
  let host;
  try {
    host = await createPracticeHost({ config, stateDir, fetchJwks });
    for (const denied of [{ ...body, orderId: 'synthetic-historical' }, { ...body, test: false }]) assert.equal((await call(host, '/v1/orders', 'ship:orders', denied)).status, 403);
    assert.equal((await call(host, '/v1/orders', 'ship:orders', body)).status, 200);
    const namespace = await host.mf.getDurableObjectNamespace('SHIP_STORES');
    const store = namespace.get(namespace.idFromName('backroadbum'));
    assert.equal((await store.saveShipFrom({ name: 'Fixture store', line1: '2 Example Way', city: 'Example', region: 'CA', postalCode: '90000' })).ok, true);
    assert.equal((await store.addBox({ name: 'Fixture box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' })).ok, true);
    assert.equal((await store.getOrder(body.orderId)).email, null);
    const boxId = (await store.getSettings()).boxes[0].boxId;
    const request = { version: 1, boxId, weightOz: 9, service: 'PM', by: 'Fixture merchant' };
    assert.equal((await call(host, '/v1/admin/orders/' + body.orderId + '/labels', 'ship:admin', request)).status, 403);
    const bought = await call(host, '/v1/admin/orders/' + body.orderId + '/labels', 'ship:admin', { ...request, kind: 'practice' });
    assert.equal(bought.status, 201);
    const { label } = await bought.json();
    assert.equal(label.test, true); assert.equal(label.practice, true); assert.equal(label.delivery, null); assert.equal(label.priceCents, null);
    assert.match(label.tracking, /^TEST/);
    assert.equal((await call(host, '/v1/admin/orders/' + body.orderId + '/labels', 'ship:admin', { ...request, kind: 'practice' })).status, 409);
    const print = await (await call(host, '/v1/admin/labels/' + label.labelId + '/print-link', 'ship:admin', {})).json();
    const pdf = await host.fetch(new URL(print.url).pathname);
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    assert.match(await pdf.text(), /TEST - NOT POSTAGE/);
    const events = await (await call(host, '/v1/labels', 'ship:orders')).json(); assert.equal(events.length, 1);
    assert.equal(host.network().refusedFetches, 0);
    await host.dispose(); host = await createPracticeHost({ config, stateDir, fetchJwks });
    assert.deepEqual(await (await call(host, '/v1/labels', 'ship:orders')).json(), events);
    assert.equal((await call(host, '/v1/labels/ack', 'ship:orders', { eventId: events[0].eventId })).status, 200);
    assert.deepEqual(await (await call(host, '/v1/labels', 'ship:orders')).json(), []);
    assert.equal((await call(host, '/v1/admin/labels/' + label.labelId + '/cancel', 'ship:admin', {})).status, 200);
    const summary = await (await call(host, '/v1/admin/orders/' + body.orderId, 'ship:admin')).json();
    assert.equal(summary.order.labels[0].status, 'cancelled');
    assert.equal(host.network().refusedFetches, 0);
    await host.dispose(); host = undefined;
    await assert.rejects(createPracticeHost({ config: { ...config, generation: 'different-generation' }, stateDir, fetchJwks }));
    await assert.rejects(createPracticeHost({ config: { ...config, allowedOrderId: 'different-order' }, stateDir, fetchJwks }));
  } finally { if (host) await host.dispose(); rmSync(stateDir, { recursive: true, force: true }); }
});
