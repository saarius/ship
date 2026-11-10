// Merchant-only read-only view, rendered by EmDash Block Kit inside the Registry sandbox.
import type { BlockResponse } from '@emdash-cms/blocks/server';
import type { PluginContext, SandboxedRouteContext } from 'emdash/plugin';
import { tradeStoreKey, admitPass } from './ship.js';
const ORIGIN = 'https://backroadbum.com', SITE = 'backroadbum', ID = 'r_ehdlg5cxkb3ffqvr';
const error = (title: string, description: string): BlockResponse => ({ blocks: [
  { type: 'header', text: 'Shipments' }, { type: 'banner', variant: 'error', title, description },
] });
async function read(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw Error('unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 1024 * 1024) throw Error('answer_too_large'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export async function shippingAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (route.ui?.surface !== 'admin-page' || !route.user?.id || typeof route.user.role !== 'number' || route.user.role < 50) {
    return error('Administrator access required', 'This merchant connection is visible only to site Administrators.');
  }
  const input = route.input;
  if (!record(input) || !(input.type === 'page_load' || input.type === 'block_action' && input.action_id === 'refresh')) {
    return error('Action unavailable', 'This connection view is read-only. It cannot admit orders or create labels.');
  }
  if (ctx.site?.url !== ORIGIN || ctx.plugin?.id !== ID || !ctx.http || !ctx.settings) {
    return error('Merchant profile unavailable', 'Ask the operator to check this installation and its fixed merchant address.');
  }
  try {
    const saved = await ctx.settings.getVersioned<unknown>('connection');
    const connection: unknown = typeof saved?.value === 'string' ? JSON.parse(saved.value) : null;
    if (!record(connection) || Object.keys(connection).sort().join() !== 'siteId,storeKey' || connection.siteId !== SITE ||
        typeof connection.storeKey !== 'string' || !/^dk_store_[A-Za-z0-9_-]{43}$/.test(connection.storeKey)) {
      return error('Ship connection not provisioned', 'The operator must install this plugin’s separate merchant key in its encrypted connection setting.');
    }
    // Trade per load, not KV-cached. Disabling the private grant stops the next refresh.
    const token = await tradeStoreKey(ctx, SITE, connection.storeKey);
    const call = async (path: string) => {
      admitPass(token, SITE);
      return read(await ctx.http!.fetch(ORIGIN + '/api/ship/v1/admin/' + path, { method: 'GET', cache: 'no-store', redirect: 'error',
        headers: { accept: 'application/json', authorization: 'Bearer ' + token } }));
    };
    const status = await call('status');
    if (!record(status) || status.schema !== 'backroadbum.ship-admin/v1' || status.mode !== 'test' || status.provider !== 'practice' ||
        status.admission !== 'closed' || status.commerceConnected !== false) throw Error('unexpected_status');
    const list = await call('orders');
    if (!record(list) || !Array.isArray(list.orders) || list.orders.length !== 0) throw Error('unexpected_orders');
    return { blocks: [
      { type: 'header', text: 'Shipments' },
      { type: 'fields', fields: [
        { label: 'Merchant connection', value: 'Verified · read-only' },
        { label: 'Order intake', value: 'Closed' },
        { label: 'Commerce handoff', value: 'Not connected' },
        { label: 'Label provider', value: 'Practice only' },
      ] },
      { type: 'banner', variant: 'alert', title: 'No orders admitted',
        description: 'Ship is reachable, but Commerce is not sending orders here. Setup and label actions are not enabled in this profile.' },
      { type: 'context', text: 'The next integration step is a bounded handoff of one fresh paid TEST order. Existing orders have not been imported.' },
      { type: 'actions', elements: [{ type: 'button', label: 'Refresh connection', action_id: 'refresh' }] },
    ] };
  } catch {
    return { blocks: [...error('Ship connection unavailable', 'The connection could not be verified. Refresh to try again, or ask the operator to check the plugin grant and private Ship host.').blocks,
      { type: 'actions', elements: [{ type: 'button', label: 'Refresh connection', action_id: 'refresh' }] }] };
  }
}
