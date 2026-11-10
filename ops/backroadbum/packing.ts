// Merchant-only settings adapter. No provider/account, order or label action is admitted.
import type { StoreShipping, Settings } from '../../service/src/store.js';
import { ServiceError, type Outcome } from '../../service/src/errors.js';
type Store = DurableObjectStub<StoreShipping>;
const SCHEMA = 'backroadbum.ship-packing/v1';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const refuse = () => { throw new ServiceError(400, 'INVALID_INPUT', 'Use only the fields in the practice packing form.'); };
const projection = (settings: Settings) => ({ schema: SCHEMA, shipFrom: settings.shipFrom, boxes: settings.boxes });
const fieldsFor: Record<string, readonly string[]> = {
  'ship-from': ['name', 'company', 'line1', 'line2', 'city', 'region', 'postalCode'],
  'add-box': ['name', 'lengthIn', 'widthIn', 'heightIn', 'weightOz'],
  'remove-box': ['boxId'],
};
async function input(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) refuse();
  const reader = request.body?.getReader(); if (!reader) return refuse();
  const bytes = new Uint8Array(16384); let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (length + value.length > bytes.length) throw new ServiceError(413, 'BODY_TOO_LARGE', 'Packing forms are limited to 16 KiB.');
      bytes.set(value, length); length += value.length;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length))); } catch { return refuse(); }
  if (!record(body) || Object.keys(body).sort().join() !== 'action,fields' || typeof body.action !== 'string' ||
      !Object.hasOwn(fieldsFor, body.action) || !record(body.fields)) return refuse();
  const fields = body.fields, action = body.action;
  if (Object.keys(fields).some(key => !fieldsFor[action]!.includes(key)) ||
      Object.values(fields).some(value => typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value))) return refuse();
  if (body.action === 'remove-box' && (Object.keys(fields).join() !== 'boxId' || !/^box_[A-Za-z0-9-]{1,80}$/.test(String(fields.boxId)))) return refuse();
  return { action: body.action, fields };
}
export async function packingSettings(request: Request, store: Store): Promise<Response> {
  try {
    if (request.method === 'GET') return json(projection(await store.getSettings()));
    if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST.' } }, 405);
    const { action, fields } = await input(request);
    // Outcome's unknown body is wider than workerd's RPC serializable type; the owning service uses the same boundary cast.
    const result = (action === 'ship-from' ? await store.saveShipFrom(fields)
      : action === 'add-box' ? await store.addBox(fields) : await store.removeBox(String(fields.boxId))) as unknown as Outcome;
    if (!result.ok) return json({ error: { code: result.code, message: result.message } }, result.status);
    // Never return postage accounts, reply-to addresses, email settings or private print configuration.
    return json(projection(await store.getSettings()), result.status);
  } catch (error) {
    if (error instanceof ServiceError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'UNAVAILABLE', message: 'Packing settings could not be confirmed. Refresh before retrying a save.' } }, 503);
  }
}
