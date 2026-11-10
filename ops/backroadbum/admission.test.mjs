import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createPracticeHost } from './runtime.mjs';
const require = createRequire(new URL('../../service/package.json', import.meta.url));
const { generateKeyPair, exportJWK, SignJWT } = require('jose');
const origin = 'https://backroadbum.com', admissionPath = '/v1/admin/admission';
const keys = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'admission-fixture', alg: 'ES256', use: 'sig' };
const fetchJwks = async () => Response.json({ keys: [jwk] });
const config = { schema: 'backroadbum.ship-node/v1', generation: 'synthetic-admission', allowedOrderId: '', sessionSecret: 'synthetic-secret-for-local-proof-only-not-a-deployed-key' };
const order = { schema: 'dinkuskit.commerce.ship-order/v1', orderId: 'synthetic-fresh', number: 9999, version: 1, status: 'processing', test: true,
  shipTo: { name: 'Fixture', line1: '1 Example Way', city: 'Example', region: 'CA', postalCode: '90000', country: 'US' }, email: 'fixture@example.test', completed: null,
  lines: [{ catalogItemId: 'synthetic-item', name: 'Fixture mug', quantity: 1, weightOz: 8 }] };
async function pass(scope = 'ship:admin', extra = {}, audience = 'backroadbum-ship') {
  return new SignJWT({ site_id: 'backroadbum', site_origin: origin, scope, ...extra })
    .setProtectedHeader({ alg: 'ES256', kid: 'admission-fixture' }).setIssuer(origin).setAudience(audience)
    .setSubject('synthetic-operator').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
async function call(host, path = admissionPath, body, options = {}) {
  const method = options.method ?? (body === undefined ? 'GET' : 'POST');
  return host.fetch(path, { method, headers: { authorization: 'Bearer ' + (options.token ?? await pass(options.scope, options.extra, options.audience)),
    'content-type': options.contentType ?? 'application/json' }, ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(body) }) });
}
const initial = { schema: 'backroadbum.ship-admission/v1', revision: 0, orderId: null, enabled: false, updatedAt: null };
await build();
test('admission is exact-site admin-only, strictly bounded and rejects stale or malformed commands without effects', async () => {
  const host = await createPracticeHost({ config, fetchJwks });
  try {
    assert.equal((await host.fetch(admissionPath)).status, 401);
    for (const options of [{ scope: 'ship:orders' }, { extra: { site_id: 'foreign' } }, { extra: { site_origin: 'https://foreign.invalid' } }]) {
      assert.equal((await call(host, admissionPath, undefined, options)).status, 403);
    }
    assert.equal((await call(host, admissionPath, undefined, { audience: 'backroadbum-payments' })).status, 401);
    assert.equal((await call(host, admissionPath, {}, { method: 'PUT' })).status, 405);
    for (const body of [null, [], {}, { revision: 0, enabled: true, orderId: null }, { revision: -1, enabled: false, orderId: null },
      { revision: '0', enabled: false, orderId: null }, { revision: 0, enabled: 'false', orderId: null },
      { revision: 0, enabled: true, orderId: '../order' }, { revision: 0, enabled: true, orderId: 'x'.repeat(201) },
      { revision: 0, enabled: true, orderId: 'fixture', provider: 'live' }]) {
      assert.equal((await call(host, admissionPath, body)).status, 400);
    }
    for (const options of [{ raw: '{bad' }, { contentType: 'text/plain' }, { contentType: 'application/json-patch+json' }]) {
      assert.equal((await call(host, admissionPath, {}, options)).status, 400);
    }
    assert.equal((await call(host, admissionPath, {}, { raw: ' '.repeat(2049) })).status, 413);
    assert.deepEqual(await (await call(host)).json(), initial);
    assert.equal((await call(host, admissionPath, { revision: 1, orderId: 'fixture', enabled: true })).status, 409);
    assert.equal((await call(host, '/v1/orders', order, { scope: 'ship:orders' })).status, 403);
    assert.deepEqual(await (await call(host)).json(), initial);
    assert.equal(host.network().refusedFetches, 0);
  } finally { await host.dispose(); }
});
test('selection is compare-and-set, pinned for its generation and durable without replacing saved packing', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'brb-admission-')); let host;
  try {
    host = await createPracticeHost({ config, stateDir, fetchJwks });
    assert.equal((await call(host, '/v1/admin/practice-settings', { action: 'ship-from', fields: {
      name: 'Fixture store', line1: '2 Example Way', city: 'Example', region: 'CA', postalCode: '90000',
    } })).status, 200);
    const packing = await (await call(host, '/v1/admin/practice-settings', { action: 'add-box', fields: {
      name: 'Fixture box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1',
    } })).json();
    const responses = await Promise.all(['synthetic-fresh', 'synthetic-other'].map(orderId => call(host, admissionPath, { revision: 0, enabled: false, orderId })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const selected = await (await call(host)).json();
    assert.equal(selected.revision, 1); assert.equal(selected.enabled, false); assert.ok(selected.orderId);
    assert.ok(Number.isFinite(Date.parse(selected.updatedAt)));
    assert.equal((await call(host, admissionPath, { revision: 1, enabled: true, orderId: selected.orderId + '-replacement' })).status, 409);
    assert.equal((await call(host, admissionPath, { revision: 1, enabled: false, orderId: null })).status, 409);
    const enabled = await (await call(host, admissionPath, { revision: 1, enabled: true, orderId: selected.orderId })).json();
    assert.equal(enabled.revision, 2); assert.equal(enabled.enabled, true);
    assert.deepEqual(await (await call(host, admissionPath, { revision: 2, enabled: true, orderId: selected.orderId })).json(), enabled);
    const admitted = { ...order, orderId: selected.orderId };
    assert.equal((await call(host, '/v1/orders', { ...admitted, orderId: 'historical' }, { scope: 'ship:orders' })).status, 403);
    assert.equal((await call(host, '/v1/orders', { ...admitted, test: false }, { scope: 'ship:orders' })).status, 403);
    assert.equal((await call(host, '/v1/orders', admitted, { scope: 'ship:orders' })).status, 200);
    const ns = await host.mf.getDurableObjectNamespace('SHIP_STORES'); const store = ns.get(ns.idFromName('backroadbum'));
    assert.equal((await store.getOrder(selected.orderId)).email, null);
    assert.deepEqual((await store.getSettings()).shipFrom, packing.shipFrom);
    assert.deepEqual((await store.getSettings()).boxes, packing.boxes);
    await host.dispose(); host = await createPracticeHost({ config, stateDir, fetchJwks });
    assert.deepEqual(await (await call(host)).json(), enabled);
    assert.equal((await call(host, '/v1/admin/practice-settings')).status, 200);
    assert.equal((await (await host.fetch('/health')).json()).admission, 'selected-order');
    assert.equal(host.network().refusedFetches, 0);
  } finally { if (host) await host.dispose(); rmSync(stateDir, { recursive: true, force: true }); }
});
test('disable blocks intake, explicit label creation, event pickup and ACK using already-issued passes; same-order re-enable recovers pending event', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'brb-admission-disable-')); let host;
  try {
    host = await createPracticeHost({ config, stateDir, fetchJwks });
    const machineToken = await pass('ship:orders'); const adminToken = await pass('ship:admin');
    const machine = (path, body) => call(host, path, body, { token: machineToken });
    await call(host, admissionPath, { revision: 0, orderId: order.orderId, enabled: true });
    assert.equal((await machine('/v1/orders', order)).status, 200);
    const ns = await host.mf.getDurableObjectNamespace('SHIP_STORES'); const store = ns.get(ns.idFromName('backroadbum'));
    await store.saveShipFrom({ name: 'Fixture store', line1: '2 Example Way', city: 'Example', region: 'CA', postalCode: '90000' });
    await store.addBox({ name: 'Fixture box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' });
    const boxId = (await store.getSettings()).boxes[0].boxId;
    const labelPath = '/v1/admin/orders/' + order.orderId + '/labels';
    const fields = { version: 1, boxId, weightOz: 9, service: 'GA', by: 'Fixture merchant', kind: 'practice' };
    const bought = await call(host, labelPath, fields, { token: adminToken }); assert.equal(bought.status, 201);
    const { label } = await bought.json(); assert.equal(label.practice, true); assert.equal(label.priceCents, null); assert.equal(label.delivery, null);
    const events = await (await machine('/v1/labels')).json(); assert.equal(events.length, 1);
    assert.equal((await machine('/v1/labels/ack', { eventId: 'foreign-event' })).status, 403);
    const disabled = await (await call(host, admissionPath, { revision: 1, orderId: order.orderId, enabled: false }, { token: adminToken })).json();
    assert.equal(disabled.revision, 2); assert.equal(disabled.enabled, false);
    for (const [path, body] of [['/v1/orders', { ...order, version: 2 }], ['/v1/labels', undefined], ['/v1/labels/ack', { eventId: events[0].eventId }]]) {
      assert.equal((await machine(path, body)).status, 403);
    }
    assert.equal((await call(host, labelPath, fields, { token: adminToken })).status, 403);
    assert.equal((await store.getOrder(order.orderId)).version, 1);
    await host.dispose(); host = await createPracticeHost({ config, stateDir, fetchJwks });
    assert.deepEqual(await (await call(host)).json(), disabled);
    assert.equal((await machine('/v1/labels')).status, 403);
    assert.equal((await (await host.fetch('/health')).json()).admission, 'closed');
    assert.equal((await call(host, admissionPath, { revision: 1, orderId: order.orderId, enabled: true })).status, 409);
    assert.equal((await call(host, admissionPath, { revision: 2, orderId: order.orderId, enabled: true })).status, 200);
    assert.deepEqual(await (await machine('/v1/labels')).json(), events);
    assert.equal((await machine('/v1/labels/ack', { eventId: events[0].eventId })).status, 200);
    assert.deepEqual(await (await machine('/v1/labels')).json(), []);
    assert.equal((await machine('/v1/labels/ack', { eventId: events[0].eventId })).status, 200);
    assert.equal(host.network().refusedFetches, 0);
  } finally { if (host) await host.dispose(); rmSync(stateDir, { recursive: true, force: true }); }
});
test('a racing label call either drains before disable or is refused; no label can start after disable returns', async () => {
  const host = await createPracticeHost({ config, fetchJwks });
  try {
    await call(host, admissionPath, { revision: 0, orderId: order.orderId, enabled: true });
    await call(host, '/v1/orders', order, { scope: 'ship:orders' });
    const ns = await host.mf.getDurableObjectNamespace('SHIP_STORES'); const store = ns.get(ns.idFromName('backroadbum'));
    await store.saveShipFrom({ name: 'Fixture store', line1: '2 Example Way', city: 'Example', region: 'CA', postalCode: '90000' });
    await store.addBox({ name: 'Fixture box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' });
    const boxId = (await store.getSettings()).boxes[0].boxId;
    const path = '/v1/admin/orders/' + order.orderId + '/labels';
    const fields = { version: 1, boxId, weightOz: 9, service: 'GA', by: 'Fixture merchant', kind: 'practice' };
    const [label, disabled] = await Promise.all([
      call(host, path, fields), call(host, admissionPath, { revision: 1, orderId: order.orderId, enabled: false }),
    ]);
    assert.equal(disabled.status, 200); assert.ok([201, 403].includes(label.status));
    assert.equal((await call(host, path, fields)).status, 403);
    const before = (await store.orderSummary(order.orderId)).labels.length;
    assert.equal(before, label.status === 201 ? 1 : 0);
    assert.equal((await call(host, '/v1/orders', { ...order, version: 2 }, { scope: 'ship:orders' })).status, 403);
    assert.equal((await store.orderSummary(order.orderId)).labels.length, before);
    assert.equal(host.network().refusedFetches, 0);
  } finally { await host.dispose(); }
});
test('legacy immutable selected-order fixtures cannot mutate their binding through the dynamic control', async () => {
  const host = await createPracticeHost({ config: { ...config, allowedOrderId: 'synthetic-fixed' }, fetchJwks });
  try {
    const state = await (await call(host)).json(); assert.equal(state.orderId, 'synthetic-fixed'); assert.equal(state.enabled, true);
    assert.equal((await call(host, admissionPath, { revision: 0, orderId: 'synthetic-fixed', enabled: false })).status, 409);
    assert.deepEqual(await (await call(host)).json(), state);
  } finally { await host.dispose(); }
});
