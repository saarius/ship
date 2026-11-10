// Read-only operator check of the closed merchant host and its non-public control surface.
// No order selection, setting write, label operation or raw credential output.
import assert from 'node:assert/strict';
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
const origin = 'https://backroadbum.com';
const fd = openSync('/etc/backroadbum/ship-grant.json', constants.O_RDONLY | constants.O_NOFOLLOW);
let grant;
try {
  const info = fstatSync(fd);
  assert.ok(info.isFile() && (info.mode & 0o777) === 0o600 && info.size <= 4096);
  grant = JSON.parse(readFileSync(fd, 'utf8'));
} finally { closeSync(fd); }
assert.ok(grant.schema === 'backroadbum.ship-grant/v1' && grant.siteId === 'backroadbum' && grant.enabled === true && /^dk_store_[A-Za-z0-9_-]{43}$/.test(grant.storeKey));
const exchange = await fetch(origin + '/api/store-passes', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
  headers: { authorization: 'Bearer ' + grant.storeKey, 'content-type': 'application/json' },
  body: JSON.stringify({ site_id: 'backroadbum', scope: 'ship:admin', audience: 'backroadbum-ship' }) });
assert.equal(exchange.status, 200);
const credential = (await exchange.json()).access_token;
assert.ok(typeof credential === 'string' && credential.length < 16384);
const get = url => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: {
  authorization: 'Bearer ' + credential, 'user-agent': 'BackroadBum-SelfCheck/1.0',
} });
const control = await get('http://127.0.0.1:8788/v1/admin/admission');
const legacy = process.argv.includes('--expect-legacy');
assert.equal(control.status, legacy ? 404 : 200);
const state = legacy ? null : await control.json();
if (state) assert.deepEqual(state, { schema: 'backroadbum.ship-admission/v1', revision: 0, orderId: null, enabled: false, updatedAt: null });
const health = await (await get('http://127.0.0.1:8788/health')).json();
assert.equal(health.admission, 'closed'); assert.equal(health.commerceConnected, false);
const packingResponse = await get(origin + '/api/ship/v1/admin/practice-settings'); assert.equal(packingResponse.status, 200);
const packing = await packingResponse.json();
const packingSha256 = createHash('sha256').update(JSON.stringify(packing)).digest('hex');
const listing = await get(origin + '/api/ship/v1/admin/orders'); assert.equal(listing.status, 200);
const orders = (await listing.json()).orders; assert.deepEqual(orders, []);
for (const path of ['/api/ship/v1/admin/admission', '/v1/admin/admission', '/api/ship/v1/orders', '/v1/orders', '/api/ship/v1/labels']) {
  assert.equal((await get(origin + path)).status, 404);
}
assert.equal((await fetch('http://127.0.0.1:8788/v1/admin/admission', { signal: AbortSignal.timeout(5000) })).status, legacy ? 404 : 401);
if (process.env.BACKROADBUM_PACKING_BASELINE) {
  const before = JSON.parse(readFileSync(process.env.BACKROADBUM_PACKING_BASELINE, 'utf8'));
  assert.equal(packingSha256, before.packingSha256);
}
console.log(JSON.stringify({ schema: 'backroadbum.ship-admission-check/v1', at: new Date().toISOString(),
  host: legacy ? 'before-migration' : 'versioned-admission', admission: 'closed', revision: state?.revision ?? null,
  selectedOrder: false, commerceConnected: false, packingSha256, originSaved: Boolean(packing.shipFrom),
  boxes: packing.boxes.length, orders: orders.length, publicControlAndMachineRoutes: 'not exposed', effects: 'none' }, null, 2));
