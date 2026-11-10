// Native Block Kit view; no hosted-service links or browser-supplied postage fields.
import type { BlockResponse } from '@emdash-cms/blocks/server';
interface Label { labelId: string; tracking: string; status: 'bought' | 'cancelled' }
interface PracticeOrder { orderId: string; number: number | null; version: number; status: 'processing' | 'completed';
  shipTo: { name: string; lines: string[]; city: string; region: string; postalCode: string }; addressProblem: string | null;
  lines: { name: string; quantity: number }[]; labels: Label[] }
export interface PracticeView { admission: { revision: number; orderId: string | null; enabled: boolean }; order: PracticeOrder | null }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);
const natural = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
export function practiceView(value: unknown): PracticeView {
  if (!record(value) || value.schema !== 'backroadbum.ship-practice/v1' || !record(value.admission)) throw Error('unexpected_practice');
  const a = value.admission;
  if (a.schema !== 'backroadbum.ship-admission/v1' || !natural(a.revision) || typeof a.enabled !== 'boolean' ||
      a.orderId !== null && (!text(a.orderId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(a.orderId)) || a.enabled && a.orderId === null) throw Error('unexpected_admission');
  const o = value.order;
  if (o !== null && (!record(o) || o.orderId !== a.orderId || o.test !== true || !natural(o.version, 1) ||
      o.number !== null && !natural(o.number, 1) || !['processing', 'completed'].includes(String(o.status)) ||
      o.addressProblem !== null && !text(o.addressProblem, 500) || !record(o.shipTo) ||
      !['name', 'city', 'region', 'postalCode'].every(key => text((o.shipTo as Record<string, unknown>)[key])) ||
      !Array.isArray(o.shipTo.lines) || o.shipTo.lines.length > 2 || !o.shipTo.lines.every(line => text(line)) ||
      !Array.isArray(o.lines) || o.lines.length > 100 || o.lines.some(line => !record(line) || !text(line.name) || !natural(line.quantity, 1)) ||
      !Array.isArray(o.labels) || o.labels.length > 1 || o.labels.some(label => !record(label) || !text(label.labelId) ||
        !text(label.tracking) || !/^TEST[A-Za-z0-9-]+$/.test(label.tracking) || label.practice !== true || label.test !== true ||
        label.priceCents !== null || label.delivery !== null || !['bought', 'cancelled'].includes(String(label.status))))) throw Error('unexpected_order');
  return value as unknown as PracticeView;
}
const button = (label: string, action_id: string) => ({ type: 'button' as const, label, action_id });
export function practiceTarget(actionId: string) {
  const match = /^(practice|print):([0-9]{1,16}):([0-9]{1,16}):([A-Za-z0-9._%~-]{1,600})$/.exec(actionId);
  if (!match) return null;
  try {
    const revision = Number(match[2]), version = Number(match[3]), orderId = decodeURIComponent(match[4]!);
    if (!natural(revision) || !natural(version, 1) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(orderId)) return null;
    return { action: match[1] === 'practice' ? 'create' as const : 'print' as const, revision, version, orderId };
  } catch { return null; }
}
export function practicePage(view: PracticeView, packing: { shipFrom: unknown; boxes: { boxId: string; name: string }[] },
  feedback?: { title: string; description: string; error?: boolean }, typed?: Record<string, string>, printUrl?: string): BlockResponse {
  const { admission: a, order: o } = view;
  const blocks: BlockResponse['blocks'] = [
    { type: 'header', text: 'Shipments' },
    { type: 'fields', fields: [{ label: 'Merchant connection', value: 'Verified · admin' },
      { label: 'Order intake', value: a.enabled ? 'One selected order' : 'Disabled' }, { label: 'Label provider', value: 'Practice only' }] },
    { type: 'actions', elements: [button('Refresh order', 'refresh')] },
  ];
  if (feedback) blocks.push({ type: 'banner', variant: feedback.error ? 'error' : 'default', title: feedback.title, description: feedback.description });
  if (!a.enabled) blocks.push({ type: 'banner', variant: 'alert', title: 'Order actions disabled', description: 'Stored records remain visible. The operator must re-enable this same order before a new label or print link can be made.' });
  if (!o) {
    blocks.push({ type: 'banner', variant: 'alert', title: 'Selected order not received', description: 'Ship has not received this order from Commerce. Refresh after the canonical handoff is available; selecting an ID alone is not a paid-order check.' });
    return { blocks };
  }
  const name = o.number === null ? o.orderId : '#' + o.number;
  blocks.push({ type: 'header', text: `Order ${name} (TEST)` },
    { type: 'section', text: 'Commerce state at last handoff: ' + (o.status === 'completed' ? 'Completed' : 'Processing') },
    { type: 'section', text: 'Ship to: ' + [o.shipTo.name, ...o.shipTo.lines, `${o.shipTo.city}, ${o.shipTo.region} ${o.shipTo.postalCode}`].join(', ') },
    { type: 'table', page_action_id: 'refresh', columns: [{ key: 'name', label: 'Item' }, { key: 'quantity', label: 'Quantity' }], rows: o.lines.map(line => ({ name: line.name, quantity: line.quantity })) });
  const label = o.labels[0];
  if (label) {
    blocks.push({ type: 'section', text: 'Practice label: ' + (label.status === 'bought' ? 'Created · no postage' : 'Cancelled') },
      { type: 'section', text: 'Demo tracking reference: ' + label.tracking },
      { type: 'context', text: 'A label record is not a Commerce completion, carrier scan or delivery. No parcel is sent.' });
    if (a.enabled && label.status === 'bought') blocks.push({ type: 'actions', elements: [button('Prepare print link', `print:${a.revision}:${o.version}:${encodeURIComponent(o.orderId)}`)] });
    if (printUrl) blocks.push({ type: 'actions', elements: [{ type: 'link', label: 'Open practice PDF', target: { kind: 'external', url: printUrl } }] },
      { type: 'context', text: 'This private link opens only this PDF and expires in five minutes. The PDF is marked TEST – NOT POSTAGE.' });
  } else if (a.enabled && o.status === 'processing') {
    if (o.addressProblem || !packing.shipFrom || !packing.boxes.length) blocks.push({ type: 'banner', variant: 'alert', title: 'Packing not ready', description: o.addressProblem ?? 'An origin and box must be saved before selecting an order. Ask the operator to inspect this generation.' });
    else blocks.push({ type: 'header', text: 'Create a practice label' },
      { type: 'context', text: 'Choose a saved box and enter the total packed weight. One practice label can be made for this order; there is no re-buy or live-postage action.' },
      { type: 'form', block_id: 'practice-label-' + crypto.randomUUID(), fields: [
        { type: 'select', action_id: 'boxId', label: 'Box', options: packing.boxes.map(box => ({ label: box.name, value: box.boxId })), initial_value: packing.boxes.some(box => box.boxId === typed?.boxId) ? typed!.boxId : packing.boxes[0]!.boxId },
        { type: 'text_input', action_id: 'weightOz', label: 'Total packed weight (ounces)', initial_value: typed?.weightOz ?? '' },
      ], submit: { label: 'Create practice label', action_id: `practice:${a.revision}:${o.version}:${encodeURIComponent(o.orderId)}` } });
  }
  return { blocks };
}
