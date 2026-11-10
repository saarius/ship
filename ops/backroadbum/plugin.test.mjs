import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlockResponse } from '@emdash-cms/blocks/server';
import plugin from '../../dist/backroadbum/dist/plugin.mjs';
const ORIGIN = 'https://backroadbum.com', KEY = 'dk_store_' + 'k'.repeat(43);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = (patch = {}) => [b64({ alg: 'ES256' }), b64({ iss: ORIGIN, aud: 'backroadbum-ship', site_id: 'backroadbum',
  scope: 'ship:admin', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...patch }), b64('fixture')].join('.');
const status = { schema: 'backroadbum.ship-admin/v1', mode: 'test', provider: 'practice', admission: 'closed', commerceConnected: false };
const empty = { schema: 'backroadbum.ship-packing/v1', shipFrom: null, boxes: [] };
const from = { name: 'Demo', line1: '1 Example Way', city: 'Example', region: 'CA', postalCode: '90000' };
function host({ role = 50, surface = 'admin-page', site = ORIGIN, id = 'r_ehdlg5cxkb3ffqvr', saved = JSON.stringify({ siteId: 'backroadbum', storeKey: KEY }),
  pass = token(), health = status, orders = [], packing = empty, fail = '', size = false, mutationError = 0 } = {}) {
  const calls = []; let kept = structuredClone(packing);
  const ctx = { site: { url: site }, plugin: { id }, settings: { getVersioned: async () => ({ value: saved, revision: '1' }) },
    http: { async fetch(url, init) {
      calls.push({ url, init });
      if (url.includes(fail) && fail) return new Response('sk_test_do_not_echo private data', { status: 503 });
      if (url === ORIGIN + '/api/store-passes') return Response.json({ access_token: pass });
      if (size) return new Response(' '.repeat(1024 * 1024 + 1));
      if (url.endsWith('/status')) return Response.json(health);
      if (url.endsWith('/orders')) return Response.json({ orders });
      if (url.endsWith('/practice-settings')) {
        if (init.method === 'POST') {
          if (mutationError) return Response.json({ error: { code: mutationError === 400 ? 'INVALID_INPUT' : 'UNAVAILABLE', message: mutationError === 400 ? 'Length (in) must be from 0.1 to 108.' : 'sk_test_do_not_echo' } }, { status: mutationError });
          const { action, fields } = JSON.parse(init.body);
          if (action === 'ship-from') kept.shipFrom = fields;
          if (action === 'add-box') kept.boxes.push({ boxId: 'box_fixture', ...fields, lengthIn: 6, widthIn: 4, heightIn: 3, weightOz: 1 });
          if (action === 'remove-box') kept.boxes = kept.boxes.filter(box => box.boxId !== fields.boxId);
        }
        return Response.json(kept);
      }
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
test('only an administrator on this installation can read or mutate packing', async () => {
  for (const options of [{ role: 40 }, { role: 30 }, { surface: 'other' }, { site: 'https://other.invalid' }, { id: 'dinkus-ship' }]) {
    const h = host(options); await h.page(); await h.page({ type: 'form_submit', action_id: 'save-origin', values: from }); assert.equal(h.calls.length, 0);
  }
  for (const saved of [null, '{broken', JSON.stringify({ siteId: 'other', storeKey: KEY }), JSON.stringify({ siteId: 'backroadbum', storeKey: KEY, extra: 1 })]) {
    const h = host({ saved }); assert.match(await h.page(), /not provisioned|unavailable/); assert.equal(h.calls.length, 0);
  }
});
test('unknown, label, connect, malformed packing and intake actions never dispatch', async () => {
  for (const input of [{ type: 'block_action', action_id: 'connect' }, { type: 'block_action', action_id: 'open', value: 'order:fixture' },
    { type: 'form_submit', action_id: 'buy:1:order', values: { kind: 'practice' } }, null,
    { type: 'form_submit', action_id: 'save-origin', values: { ...from, account: 'forbidden' } },
    { type: 'block_action', action_id: 'remove-box', value: '../bad' }]) {
    const h = host(); assert.match(await h.page(input), /packing|Packing/); assert.equal(h.calls.length, 0);
  }
});
test('load and refresh use exact-host scoped exchange; no secrets or dead links in status view', async () => {
  const h = host();
  for (const input of [{ type: 'page_load' }, { type: 'block_action', action_id: 'refresh' }]) {
    const page = await h.page(input); assert.match(page, /Verified · admin/); assert.match(page, /No orders admitted/); assert.match(page, /Packing setup/);
    assert.doesNotMatch(page, /dk_store_|access_token|privateKey|https:\/\/|Connect Ship|Buy label/);
  }
  assert.equal(h.calls.length, 8);
  for (let start = 0; start < 8; start += 4) {
    const [trade, ...reads] = h.calls.slice(start, start + 4);
    assert.equal(trade.url, ORIGIN + '/api/store-passes'); assert.equal(trade.init.headers.authorization, 'Bearer ' + KEY);
    assert.deepEqual(JSON.parse(trade.init.body), { site_id: 'backroadbum', scope: 'ship:admin', audience: 'backroadbum-ship' });
    for (const call of reads) {
      assert.equal(call.init.method, 'GET'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
      assert.notEqual(call.init.headers.authorization, 'Bearer ' + KEY); assert.ok(call.url.startsWith(ORIGIN + '/api/ship/v1/admin/'));
    }
  }
});
test('packing forms save and remove through the same fresh admin pass, with success only after a checked response', async () => {
  const h = host();
  assert.match(await h.page({ type: 'block_action', action_id: 'packing' }), /No origin address saved|No box sizes saved/);
  assert.match(await h.page({ type: 'form_submit', action_id: 'save-origin', values: from }), /Origin address saved/);
  assert.match(await h.page({ type: 'form_submit', action_id: 'add-box', values: { name: 'Demo box', lengthIn: '6', widthIn: '4', heightIn: '3', weightOz: '1' } }), /Box size added/);
  assert.match(await h.page({ type: 'block_action', action_id: 'packing' }), /Demo box/);
  assert.match(await h.page({ type: 'block_action', action_id: 'remove-box', value: 'box_fixture' }), /Box size removed/);
  const mutations = h.calls.filter(call => call.url.endsWith('/practice-settings') && call.init.method === 'POST');
  assert.equal(mutations.length, 3);
  assert.deepEqual(JSON.parse(mutations[0].init.body), { action: 'ship-from', fields: from });
  assert.ok(mutations.every(call => call.init.headers['content-type'] === 'application/json' && call.init.redirect === 'error'));
  assert.equal(h.calls.filter(call => call.url.endsWith('/api/store-passes')).length, 5);
});
test('invalid input retains typed values; uncertain save has no success or automatic replay', async () => {
  for (const mutationError of [400, 503]) {
    const h = host({ mutationError });
    const page = await h.page({ type: 'form_submit', action_id: 'add-box', values: { name: 'Keep typed', lengthIn: '0', widthIn: '4', heightIn: '3', weightOz: '1' } });
    assert.match(page, mutationError === 400 ? /Packing not saved.*Length \(in\).*Keep typed/ : /Packing save not confirmed/);
    assert.doesNotMatch(page, /Box size added|sk_test_do_not_echo/);
    assert.equal(h.calls.filter(call => call.url.endsWith('/practice-settings') && call.init.method === 'POST').length, 1);
  }
});
test('missing/wrong/expired passes, outages, changed admission or unexpected data cannot become a verified empty list', async () => {
  for (const options of [{ pass: '' }, { pass: token({ aud: 'backroadbum-payments' }) }, { pass: token({ iss: 'https://dinkuskit.com/account' }) },
    { pass: token({ site_id: 'other' }) }, { pass: token({ scope: 'ship:orders' }) }, { pass: token({ exp: 1 }) },
    { fail: '/api/store-passes' }, { fail: '/status' }, { fail: '/orders' }, { fail: '/practice-settings' }, { health: { ...status, admission: 'selected-order' } },
    { health: { ...status, commerceConnected: true } }, { health: { ...status, provider: 'live' } }, { orders: [{}] }, { packing: { ...empty, schema: 'foreign' } }, { size: true }]) {
    const h = host(options); const page = await h.page(); assert.match(page, /connection unavailable/); assert.doesNotMatch(page, /No orders admitted|sk_test_do_not_echo/);
  }
});
