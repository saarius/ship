import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { build, createPracticeHost } from './runtime.mjs';
const require = createRequire(new URL('../../service/package.json', import.meta.url));
const { generateKeyPair, exportJWK, SignJWT } = require('jose');
const origin = 'https://backroadbum.com';
const keys = await generateKeyPair('ES256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'practice-fixture', alg: 'ES256', use: 'sig' };
const config = { schema: 'backroadbum.ship-node/v1', generation: 'synthetic-practice-ui', allowedOrderId: '', sessionSecret: 'synthetic-secret-for-local-proof-only-not-a-deployed-key' };
const order = { schema: 'dinkuskit.commerce.ship-order/v1', orderId: 'synthetic-fresh', number: 9999, version: 1, status: 'processing', test: true,
  shipTo: { name: 'Fixture', line1: '1 Example Way', city: 'Example', region: 'CA', postalCode: '90000', country: 'US' }, email: 'fixture@example.test', completed: null,
  lines: [{ catalogItemId: 'synthetic-item', name: 'Fixture mug', quantity: 1, weightOz: 8 }] };
async function pass(scope = 'ship:admin', extra = {}) {
  return new SignJWT({ site_id: 'backroadbum', site_origin: origin, scope, ...extra })
    .setProtectedHeader({ alg: 'ES256', kid: 'practice-fixture' }).setIssuer(origin).setAudience('backroadbum-ship')
    .setSubject('synthetic-operator').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
async function call(host, path, body, options = {}) {
  return host.fetch('/v1/admin/' + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    authorization: 'Bearer ' + (options.token ?? await pass(options.scope, options.extra)), 'content-type': 'application/json',
  }, ...(body === undefined ? {} : { body: options.raw ?? JSON.stringify(body) }) });
}
async function prepared() {
  const host = await createPracticeHost({ config, fetchJwks: async () => Response.json({ keys: [jwk] }) });
  await call(host, 'practice-settings', { action: 'ship-from', fields: { name: 'Fixture store', line1: '2 Example Way', city: 'Example', region: 'CA', postalCode: '90000' } });
  const packing = await (await call(host, 'practice-settings', { action: 'add-box', fields: { name: 'Fixture box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' } })).json();
  return { host, packing, command: { action: 'create', revision: 1, orderId: order.orderId, version: 1, boxId: packing.boxes[0].boxId, weightOz: 9, by: 'fixture-merchant' } };
}
async function select(host) { assert.equal((await call(host, 'admission', { revision: 0, orderId: order.orderId, enabled: true })).status, 200); }
async function send(host, value = order) {
  return host.fetch('/v1/orders', { method: 'POST', headers: { authorization: 'Bearer ' + await pass('ship:orders'), 'content-type': 'application/json' }, body: JSON.stringify(value) });
}
await build();
test('practice endpoint enforces admin auth and strict bounded commands; selection is not an order', async () => {
  const { host, command } = await prepared();
  try {
    assert.equal((await host.fetch('/v1/admin/practice-order')).status, 401);
    for (const options of [{ scope: 'ship:orders' }, { extra: { site_id: 'foreign' } }, { extra: { site_origin: 'https://foreign.invalid' } }]) {
      assert.equal((await call(host, 'practice-order', undefined, options)).status, 403);
      assert.equal((await call(host, 'practice-label', command, options)).status, 403);
    }
    assert.equal((await call(host, 'practice-label')).status, 405);
    assert.equal((await call(host, 'practice-order', {})).status, 405);
    for (const body of [{ ...command, service: 'PM' }, { ...command, kind: 'live' }, { ...command, buyAgain: true }, { ...command, weightOz: '9' },
      { ...command, weightOz: 0 }, { ...command, weightOz: 1121 }, { ...command, version: 0 }, { ...command, revision: -1 },
      { ...command, by: 'bad\nactor' }, { ...command, action: 'cancel' }, { ...command, boxId: '../bad' }, {}]) {
      assert.equal((await call(host, 'practice-label', body)).status, 400);
    }
    assert.equal((await call(host, 'practice-label', {}, { raw: ' '.repeat(2049) })).status, 413);
    assert.equal((await call(host, 'practice-label', command)).status, 403);
    assert.equal((await (await call(host, 'practice-order')).json()).order, null);
    await select(host);
    assert.equal((await (await call(host, 'practice-order')).json()).order, null);
    assert.equal((await call(host, 'practice-label', command)).status, 409);
    assert.equal(host.network().refusedFetches, 0);
  } finally { await host.dispose(); }
});
test('native command makes one durable practice label; replay, foreign/version changes and disabled old passes cannot buy again', async () => {
  const { host, command, packing } = await prepared();
  try {
    await select(host); assert.equal((await send(host)).status, 200);
    assert.equal((await call(host, 'practice-settings')).status, 200);
    assert.equal((await call(host, 'practice-settings', { action: 'remove-box', fields: { boxId: packing.boxes[0].boxId } })).status, 403);
    for (const patch of [{ revision: 0 }, { version: 2 }, { orderId: 'foreign' }, { boxId: 'box_foreign' }]) {
      assert.ok([400, 403, 409].includes((await call(host, 'practice-label', { ...command, ...patch })).status));
    }
    const results = await Promise.all([call(host, 'practice-label', command), call(host, 'practice-label', command)]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    const view = await (await call(host, 'practice-order')).json();
    assert.equal(view.order.labels.length, 1); const label = view.order.labels[0];
    assert.equal(label.practice, true); assert.equal(label.test, true); assert.equal(label.priceCents, null); assert.equal(label.delivery, null);
    assert.equal(label.createdBy, 'admin:fixture-merchant'); assert.match(label.tracking, /^TEST/);
    assert.ok(!JSON.stringify(view).includes(order.email));
    const printCommand = { action: 'print', revision: 1, version: 1, orderId: order.orderId };
    const printed = await (await call(host, 'practice-label', printCommand)).json();
    assert.match(printed.url, /^https:\/\/backroadbum.com\/api\/ship\/print\//);
    const path = new URL(printed.url).pathname.replace('/api/ship', '');
    const pdf = await host.fetch(path); assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(Buffer.from(await pdf.arrayBuffer()).toString(), /TEST - NOT POSTAGE/);
    assert.equal((await host.fetch(path + 'tamper')).status, 410);
    assert.equal((await call(host, 'practice-label', { ...printCommand, labelId: 'foreign' })).status, 400);
    const oldPass = await pass();
    assert.equal((await call(host, 'admission', { revision: 1, orderId: order.orderId, enabled: false })).status, 200);
    assert.equal((await call(host, 'practice-label', command, { token: oldPass })).status, 403);
    assert.equal((await call(host, 'practice-label', printCommand, { token: oldPass })).status, 403);
    assert.equal((await (await call(host, 'practice-order')).json()).order.labels.length, 1);
    assert.equal((await host.fetch(path)).status, 200); // Existing print capabilities are not revoked by disable.
    assert.equal((await call(host, 'admission', { revision: 2, orderId: order.orderId, enabled: true })).status, 200);
    assert.equal((await send(host, { ...order, version: 2 })).status, 200);
    assert.equal((await call(host, 'practice-label', { ...command, revision: 3, version: 2 })).status, 409);
    assert.equal((await call(host, 'practice-label', { ...printCommand, revision: 3, version: 2 })).status, 200);
    assert.equal(host.network().refusedFetches, 0);
  } finally { await host.dispose(); }
});
test('a label/disable race cannot start a later label or print command', async () => {
  const { host, command } = await prepared();
  try {
    await select(host); await send(host);
    const [label, disabled] = await Promise.all([call(host, 'practice-label', command), call(host, 'admission', { revision: 1, orderId: order.orderId, enabled: false })]);
    assert.equal(disabled.status, 200); assert.ok([201, 403].includes(label.status));
    assert.equal((await call(host, 'practice-label', command)).status, 403);
    assert.equal((await call(host, 'practice-label', { action: 'print', revision: 1, version: 1, orderId: order.orderId })).status, 403);
  } finally { await host.dispose(); }
});
