import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import plugin from '../../dist/backroadbum/dist/plugin.mjs';
const ORIGIN = 'https://backroadbum.com', KEY = 'dk_store_' + 'k'.repeat(43);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (patch = {}) => [b64({ alg: 'ES256' }), b64({ iss: ORIGIN, aud: 'backroadbum-ship', site_id: 'backroadbum',
  scope: 'ship:admin', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...patch }), b64('fixture')].join('.');
const status = { schema: 'backroadbum.ship-admin/v1', mode: 'test', provider: 'practice', admission: 'closed', commerceConnected: false };
function host({ role = 50, surface = 'admin-page', site = ORIGIN, id = 'r_ehdlg5cxkb3ffqvr', saved = JSON.stringify({ siteId: 'backroadbum', storeKey: KEY }),
  pass = token(), health = status, orders = [], fail = '', size = false } = {}) {
  const calls = [];
  const ctx = { site: { url: site }, plugin: { id }, settings: { getVersioned: async () => ({ value: saved, revision: '1' }) },
    http: { async fetch(url, init) {
      calls.push({ url, init });
      if (url.includes(fail) && fail) return new Response('sk_test_do_not_echo private data', { status: 503 });
      if (url === ORIGIN + '/api/store-passes') return Response.json({ access_token: pass });
      if (size) return new Response(' '.repeat(1024 * 1024 + 1));
      if (url.endsWith('/status')) return Response.json(health);
      if (url.endsWith('/orders')) return Response.json({ orders });
      throw Error('unexpected_network');
    } },
  };
  const page = async (input = { type: 'page_load' }) => {
    const result = await plugin.routes.admin.handler({ user: { id: 'admin', role }, ui: { surface }, input }, ctx);
    const checked = validateBlockResponse(result); assert.equal(checked.valid, true, JSON.stringify(checked.errors)); return JSON.stringify(result);
  };
  return { page, calls };
}
test('merchant sandbox has only one private, admin-permission route', () => {
  assert.deepEqual(Object.keys(plugin.routes), ['admin']);
  assert.equal(plugin.routes.admin.public, false); assert.equal(plugin.routes.admin.permission, 'plugins:manage');
  assert.deepEqual(plugin.routes.admin.methods, ['POST']);
});
test('only an administrator on this installation can read the merchant connection', async () => {
  for (const options of [{ role: 40 }, { role: 30 }, { surface: 'other' }, { site: 'https://other.invalid' }, { id: 'dinkus-ship' }]) {
    const h = host(options); await h.page(); assert.equal(h.calls.length, 0);
  }
  for (const saved of [null, '{broken', JSON.stringify({ siteId: 'other', storeKey: KEY }), JSON.stringify({ siteId: 'backroadbum', storeKey: KEY, extra: 1 })]) {
    const h = host({ saved }); assert.match(await h.page(), /not provisioned|unavailable/); assert.equal(h.calls.length, 0);
  }
});
test('unknown, label, connect and intake actions never dispatch', async () => {
  for (const input of [{ type: 'block_action', action_id: 'connect' }, { type: 'block_action', action_id: 'open', value: 'order:fixture' },
    { type: 'form_submit', action_id: 'buy:1:order', values: { kind: 'practice' } }, null]) {
    const h = host(); assert.match(await h.page(input), /read-only/); assert.equal(h.calls.length, 0);
  }
});
test('successful load and refresh use exact-host scoped exchange; no secrets, PII or dead links in Block Kit', async () => {
  const h = host();
  for (const input of [{ type: 'page_load' }, { type: 'block_action', action_id: 'refresh' }]) {
    const page = await h.page(input); assert.match(page, /Verified · read-only/); assert.match(page, /No orders admitted/);
    assert.doesNotMatch(page, /dk_store_|access_token|privateKey|https:\/\/|Connect Ship|Buy label/);
  }
  assert.equal(h.calls.length, 6);
  for (let start = 0; start < 6; start += 3) {
    const [trade, state, list] = h.calls.slice(start, start + 3);
    assert.equal(trade.url, ORIGIN + '/api/store-passes'); assert.equal(trade.init.headers.authorization, 'Bearer ' + KEY);
    assert.deepEqual(JSON.parse(trade.init.body), { site_id: 'backroadbum', scope: 'ship:admin', audience: 'backroadbum-ship' });
    for (const call of [state, list]) {
      assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
      assert.notEqual(call.init.headers.authorization, 'Bearer ' + KEY); assert.ok(call.url.startsWith(ORIGIN + '/api/ship/v1/admin/'));
    }
  }
});
test('missing/wrong/expired passes, outages, changed admission or unexpected data are not a verified empty list', async () => {
  for (const options of [{ pass: '' }, { pass: token({ aud: 'backroadbum-payments' }) }, { pass: token({ iss: 'https://dinkuskit.com/account' }) },
    { pass: token({ site_id: 'other' }) }, { pass: token({ scope: 'ship:orders' }) }, { pass: token({ exp: 1 }) },
    { fail: '/api/store-passes' }, { fail: '/status' }, { fail: '/orders' }, { health: { ...status, admission: 'selected-order' } },
    { health: { ...status, commerceConnected: true } }, { health: { ...status, provider: 'live' } }, { orders: [{}] }, { size: true }]) {
    const h = host(options); const page = await h.page(); assert.match(page, /connection unavailable/); assert.doesNotMatch(page, /No orders admitted|sk_test_do_not_echo/);
  }
});
