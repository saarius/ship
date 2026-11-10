import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createPracticeHost } from './runtime.mjs';
const require = createRequire(new URL('../../service/package.json', import.meta.url));
const { generateKeyPair, exportJWK, SignJWT } = require('jose');
const origin = 'https://backroadbum.com', path = '/v1/admin/practice-settings';
const keys = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'packing-fixture', alg: 'ES256', use: 'sig' };
const fetchJwks = async () => Response.json({ keys: [jwk] });
const config = { schema: 'backroadbum.ship-node/v1', generation: 'synthetic-packing', allowedOrderId: '', sessionSecret: 'synthetic-secret-for-local-proof-only-not-a-deployed-key' };
const from = { name: 'Demo only', line1: '1 Example Way', city: 'Example', region: 'CA', postalCode: '90000' };
const box = { name: 'Demo box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' };
async function pass(scope = 'ship:admin', extra = {}) {
  return new SignJWT({ site_id: 'backroadbum', site_origin: origin, scope, ...extra })
    .setProtectedHeader({ alg: 'ES256', kid: 'packing-fixture' }).setIssuer(origin).setAudience('backroadbum-ship')
    .setSubject('synthetic-admin').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
async function call(host, body, { scope, extra, method = body === undefined ? 'GET' : 'POST', raw, contentType = 'application/json' } = {}) {
  return host.fetch(path, { method, headers: { authorization: 'Bearer ' + await pass(scope, extra), 'content-type': contentType },
    ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(body) }) });
}
await build();
test('practice packing is scope/site protected and never an order, label, account or email setup API', async () => {
  const host = await createPracticeHost({ config, fetchJwks });
  try {
    assert.equal((await host.fetch(path)).status, 401);
    for (const options of [{ scope: 'ship:orders' }, { extra: { site_id: 'foreign' } }, { extra: { site_origin: 'https://foreign.invalid' } }]) {
      assert.equal((await call(host, { action: 'ship-from', fields: from }, options)).status, 403);
    }
    assert.equal((await call(host, {}, { method: 'PUT' })).status, 405);
    for (const body of [{ action: 'postage', fields: {} }, { action: 'ship-from', fields: { ...from, PB_PASSWORD: 'not-a-secret' } },
      { action: 'ship-from', fields: from, orders: true }, { action: 'ship-from', fields: { ...from, name: 'bad\u0085line' } },
      { action: 'add-box', fields: { ...box, weightOz: 1 } }, { action: 'remove-box', fields: { boxId: '../label' } },
      { action: 'add-box', fields: { ...box, lengthIn: '0' } }, { action: 'ship-from', fields: { ...from, postalCode: 'bad' } }]) {
      assert.equal((await call(host, body)).status, 400);
    }
    assert.equal((await call(host, {}, { contentType: 'text/plain' })).status, 400);
    assert.equal((await call(host, {}, { raw: '{broken' })).status, 400);
    assert.equal((await call(host, {}, { raw: ' '.repeat(16385) })).status, 413);
    assert.deepEqual(await (await call(host)).json(), { schema: 'backroadbum.ship-packing/v1', shipFrom: null, boxes: [] });
  } finally { await host.dispose(); }
});
test('origin and named box save through existing Ship validators, survive restart and can be removed without other effects', async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'brb-packing-')); let host;
  try {
    host = await createPracticeHost({ config, stateDir, fetchJwks });
    assert.equal((await call(host, { action: 'ship-from', fields: from })).status, 200);
    const saved = await (await call(host, { action: 'add-box', fields: box })).json();
    assert.deepEqual(saved.shipFrom, from); assert.equal(saved.boxes.length, 1);
    assert.equal(saved.boxes[0].lengthIn, 6); assert.equal(saved.boxes[0].weightOz, 1);
    assert.deepEqual(Object.keys(saved).sort(), ['boxes', 'schema', 'shipFrom']);
    assert.equal((await call(host, { action: 'ship-from', fields: { ...from, city: '' } })).status, 400);
    assert.deepEqual(await (await call(host)).json(), saved);
    await host.dispose(); host = await createPracticeHost({ config, stateDir, fetchJwks });
    assert.deepEqual(await (await call(host)).json(), saved);
    assert.equal((await call(host, { action: 'remove-box', fields: { boxId: saved.boxes[0].boxId } })).status, 200);
    assert.equal((await call(host, { action: 'remove-box', fields: { boxId: saved.boxes[0].boxId } })).status, 200);
    assert.deepEqual((await (await call(host)).json()).boxes, []);
    assert.equal((await (await host.fetch('/health')).json()).admission, 'closed');
    const namespace = await host.mf.getDurableObjectNamespace('SHIP_STORES'); const store = namespace.get(namespace.idFromName('backroadbum'));
    assert.deepEqual(await store.listOrders(), []);
    const labels = await host.fetch('/v1/labels', { headers: { authorization: 'Bearer ' + await pass('ship:orders') } });
    assert.deepEqual(await labels.json(), []);
    const settings = await store.getSettings(); assert.equal(settings.postageConnected, false); assert.equal(settings.postageAccount, null); assert.equal(settings.replyTo, null);
    assert.equal(host.network().refusedFetches, 0);
  } finally { if (host) await host.dispose(); rmSync(stateDir, { recursive: true, force: true }); }
});
