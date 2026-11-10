// Merchant-only Block Kit admin. Packing setup does not admit orders or authorize labels.
import type { BlockResponse, FormField } from '@emdash-cms/blocks/server';
import type { PluginContext, SandboxedRouteContext } from 'emdash/plugin';
import { tradeStoreKey, admitPass } from './ship.js';
const ORIGIN = 'https://backroadbum.com', SITE = 'backroadbum', ID = 'r_ehdlg5cxkb3ffqvr';
const error = (title: string, description: string): BlockResponse => ({ blocks: [
  { type: 'header', text: 'Shipments' }, { type: 'banner', variant: 'error', title, description },
] });
async function read(response: Response): Promise<unknown> {
  if (!response.body) throw Error('unavailable');
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
const short = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);
const addressFields = [['name', 'Name'], ['company', 'Company (optional)'], ['line1', 'Address line 1'], ['line2', 'Address line 2 (optional)'],
  ['city', 'City'], ['region', 'State'], ['postalCode', 'ZIP code']] as const;
const boxFields = [['name', 'Box name'], ['lengthIn', 'Length (inches)'], ['widthIn', 'Width (inches)'], ['heightIn', 'Height (inches)'], ['weightOz', 'Empty box weight (ounces)']] as const;
interface Packing { shipFrom: Record<string, string> | null; boxes: { boxId: string; name: string; lengthIn: number; widthIn: number; heightIn: number; weightOz: number }[] }
function packing(value: unknown): Packing {
  if (!record(value) || Object.keys(value).sort().join() !== 'boxes,schema,shipFrom' || value.schema !== 'backroadbum.ship-packing/v1' ||
      value.shipFrom !== null && (!record(value.shipFrom) || addressFields.some(([key]) => value.shipFrom && (value.shipFrom as Record<string, unknown>)[key] !== undefined && !short((value.shipFrom as Record<string, unknown>)[key]))) ||
      !Array.isArray(value.boxes) || value.boxes.length > 50 || value.boxes.some(box => !record(box) || !short(box.boxId) || !/^box_[A-Za-z0-9-]{1,80}$/.test(box.boxId) || !short(box.name, 60) ||
        ['lengthIn', 'widthIn', 'heightIn', 'weightOz'].some(key => typeof box[key] !== 'number' || !Number.isFinite(box[key]) || (box[key] as number) < 0))) throw Error('unexpected_packing');
  return value as unknown as Packing;
}
class InvalidPacking extends Error {}
function formValues(value: unknown, fields: readonly (readonly [string, string])[]) {
  if (!record(value) || Object.keys(value).some(key => !fields.some(([name]) => key === name)) || Object.values(value).some(v => !short(v))) return null;
  return value as Record<string, string>;
}
const button = (label: string, action_id: string) => ({ type: 'button' as const, label, action_id });
function packingPage(saved: Packing, typed?: { action: string; values: Record<string, string> }, failure?: string, success?: string): BlockResponse {
  const fields = (pairs: readonly (readonly [string, string])[], values: Record<string, string>): FormField[] => pairs.map(([action_id, label]) =>
    ({ type: 'text_input', action_id, label, initial_value: values[action_id] ?? '' }));
  const feedback = (action: string): BlockResponse['blocks'] => [
    ...(failure && typed?.action === action ? [{ type: 'banner' as const, variant: 'error' as const, title: 'Packing not saved', description: failure }] : []),
    ...(success && (action === 'save-origin' && success.startsWith('Origin') || action === 'add-box' && success === 'Box size added' || action === 'remove-box' && success === 'Box size removed')
      ? [{ type: 'banner' as const, variant: 'default' as const, title: success }] : []),
  ];
  return { blocks: [
    { type: 'header', text: 'Practice packing' },
    { type: 'actions', elements: [button('Back to Shipments', 'refresh')] },
    { type: 'context', text: 'These settings prepare a demo return address and box sizes only. Order intake remains closed. Use a fictional US address; no postage account is connected.' },
    { type: 'header', text: 'Origin address' },
    { type: 'context', text: saved.shipFrom ? 'Saved origin loaded from Ship. Changes replace this address.' : 'No origin address saved yet.' },
    ...feedback('save-origin'),
    { type: 'form', block_id: 'practice-origin-' + crypto.randomUUID(), fields: fields(addressFields, typed?.action === 'save-origin' ? typed.values : saved.shipFrom ?? {}),
      submit: { label: 'Save origin address', action_id: 'save-origin' } },
    { type: 'header', text: 'Saved boxes' },
    ...feedback('remove-box'),
    { type: 'table', page_action_id: 'packing', empty_text: 'No box sizes saved yet.', columns: [{ key: 'name', label: 'Box' }, { key: 'size', label: 'Inches' },
      { key: 'weight', label: 'Empty weight' }, { key: 'remove', label: '', format: 'element' }], rows: saved.boxes.map(box => ({
        name: box.name, size: `${box.lengthIn} × ${box.widthIn} × ${box.heightIn}`, weight: `${box.weightOz} oz`,
        remove: { ...button('Remove', 'remove-box'), value: box.boxId, confirm: { title: 'Remove this box size?', text: 'It will no longer be offered for new practice labels. Existing label records are unchanged.', confirm: 'Remove box', deny: 'Keep box' } },
      })) },
    { type: 'header', text: 'Add a box' },
    { type: 'context', text: 'Enter the empty box’s outside dimensions and weight, not the packed order’s weight. Box sizes are yours; none are added automatically.' },
    ...feedback('add-box'),
    { type: 'form', block_id: 'practice-box-' + crypto.randomUUID(), fields: fields(boxFields, typed?.action === 'add-box' ? typed.values : {}),
      submit: { label: 'Add box size', action_id: 'add-box' } },
  ] };
}
export async function shippingAdmin(route: SandboxedRouteContext, ctx: PluginContext): Promise<BlockResponse> {
  if (route.ui?.surface !== 'admin-page' || !route.user?.id || typeof route.user.role !== 'number' || route.user.role < 50) {
    return error('Administrator access required', 'This merchant connection is visible only to site Administrators.');
  }
  const input = route.input;
  let view = false, mutation: { action: string; fields: Record<string, string> } | undefined, typed: { action: string; values: Record<string, string> } | undefined;
  if (record(input) && input.type === 'block_action' && input.action_id === 'packing') view = true;
  else if (record(input) && input.type === 'form_submit' && ['save-origin', 'add-box'].includes(String(input.action_id))) {
    const values = formValues(input.values, input.action_id === 'save-origin' ? addressFields : boxFields);
    if (!values) return error('Invalid packing form', 'Use only the named single-line fields in this form. Nothing was sent.');
    view = true; typed = { action: String(input.action_id), values };
    mutation = { action: input.action_id === 'save-origin' ? 'ship-from' : 'add-box', fields: values };
  } else if (record(input) && input.type === 'block_action' && input.action_id === 'remove-box' && short(input.value) && /^box_[A-Za-z0-9-]{1,80}$/.test(input.value)) {
    view = true; mutation = { action: 'remove-box', fields: { boxId: input.value } };
  } else if (!record(input) || !(input.type === 'page_load' || input.type === 'block_action' && input.action_id === 'refresh')) {
    return error('Action unavailable', 'This profile supports connection checks and practice packing only. It cannot admit orders or create labels.');
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
    // Trade every invocation, including each save; no KV pass cache can outlive a disabled grant.
    const token = await tradeStoreKey(ctx, SITE, connection.storeKey);
    const call = async (path: string, body?: unknown) => {
      admitPass(token, SITE);
      const response = await ctx.http!.fetch(ORIGIN + '/api/ship/v1/admin/' + path, { method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
        headers: { accept: 'application/json', authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await read(response);
      if (!response.ok) {
        if (body && response.status === 400 && record(result) && record(result.error) && result.error.code === 'INVALID_INPUT' && short(result.error.message)) throw new InvalidPacking(result.error.message);
        throw Error('unavailable');
      }
      return result;
    };
    const status = await call('status');
    if (!record(status) || status.schema !== 'backroadbum.ship-admin/v1' || status.mode !== 'test' || status.provider !== 'practice' ||
        status.admission !== 'closed' || status.commerceConnected !== false) throw Error('unexpected_status');
    const list = await call('orders');
    if (!record(list) || !Array.isArray(list.orders) || list.orders.length !== 0) throw Error('unexpected_orders');
    const current = packing(await call('practice-settings'));
    if (view) {
      if (!mutation) return packingPage(current);
      try {
        const updated = packing(await call('practice-settings', mutation));
        return packingPage(updated, undefined, undefined, mutation.action === 'ship-from' ? 'Origin address saved' : mutation.action === 'add-box' ? 'Box size added' : 'Box size removed');
      } catch (failure) {
        if (failure instanceof InvalidPacking) return packingPage(current, typed, failure.message);
        // A timeout can follow a committed save. Do not auto-retry, especially an add-box request.
        return { blocks: [...error('Packing save not confirmed', 'Refresh and inspect the saved settings before retrying. The last request may already have been saved.').blocks,
          { type: 'actions', elements: [button('Reload packing setup', 'packing')] }] };
      }
    }
    return { blocks: [
      { type: 'header', text: 'Shipments' },
      { type: 'fields', fields: [
        { label: 'Merchant connection', value: 'Verified · admin' }, { label: 'Order intake', value: 'Closed' },
        { label: 'Commerce handoff', value: 'Not connected' }, { label: 'Label provider', value: 'Practice only' },
        { label: 'Packing setup', value: `${current.shipFrom ? 'Origin saved' : 'No origin'} · ${current.boxes.length} ${current.boxes.length === 1 ? 'box' : 'boxes'}` },
      ] },
      { type: 'banner', variant: 'alert', title: 'No orders admitted',
        description: 'Packing settings can be saved here, but Commerce is not sending orders. Label actions remain disabled.' },
      { type: 'actions', elements: [button('Refresh connection', 'refresh'), button('Packing setup', 'packing')] },
    ] };
  } catch {
    return { blocks: [...error('Ship connection unavailable', 'The connection could not be verified. Refresh to try again, or ask the operator to check the plugin grant and private Ship host.').blocks,
      { type: 'actions', elements: [button('Refresh connection', 'refresh')] }] };
  }
}
