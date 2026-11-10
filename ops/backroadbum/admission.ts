// Merchant-only, single-order admission. Never changes the immutable storage generation.
import { ServiceError } from '../../service/src/errors.js';
export interface MerchantAdmissionState {
  schema: 'backroadbum.ship-admission/v1'; revision: number; orderId: string | null; enabled: boolean; updatedAt: string | null;
}
const ORDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const refuse = (code: string, message: string, status = 400): never => { throw new ServiceError(status, code, message); };
export class MerchantAdmission {
  constructor(private sql: SqlStorage, private fixedOrderId: string) {
    const exists = sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='merchant_admission'").toArray().length > 0;
    if (!exists) {
      sql.exec(`CREATE TABLE merchant_admission (
        id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0),
        order_id TEXT, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), updated_at TEXT)`);
      sql.exec('INSERT INTO merchant_admission VALUES (1, 0, ?, ?, NULL)', fixedOrderId || null, fixedOrderId ? 1 : 0);
    }
    const kept = this.read();
    if (fixedOrderId && (kept.orderId !== fixedOrderId || !kept.enabled)) throw new Error('merchant_fixed_admission_mismatch');
  }
  read(): MerchantAdmissionState {
    const row = this.sql.exec<{ revision: number; order_id: string | null; enabled: number; updated_at: string | null }>(
      'SELECT revision, order_id, enabled, updated_at FROM merchant_admission WHERE id=1').one();
    if (!Number.isSafeInteger(row.revision) || row.revision < 0 ||
        row.order_id !== null && (typeof row.order_id !== 'string' || !ORDER_ID.test(row.order_id)) ||
        ![0, 1].includes(row.enabled) || row.enabled === 1 && row.order_id === null ||
        row.updated_at !== null && (typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) ||
        (row.revision === 0) !== (row.updated_at === null) ||
        this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE order_id != ? OR ? IS NULL', row.order_id, row.order_id).one().n > 0) {
      throw new Error('merchant_admission_corrupt');
    }
    return { schema: 'backroadbum.ship-admission/v1', revision: row.revision, orderId: row.order_id,
      enabled: row.enabled === 1, updatedAt: row.updated_at };
  }
  /** Called synchronously inside the owning DO's transaction; stale commands have no effects. */
  change(input: unknown): MerchantAdmissionState {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('INVALID_INPUT', 'Use a versioned admission command.');
    const fields = input as Record<string, unknown>;
    if (Object.keys(fields).sort().join() !== 'enabled,orderId,revision' ||
        !Number.isSafeInteger(fields.revision) || (fields.revision as number) < 0 || typeof fields.enabled !== 'boolean' ||
        fields.orderId !== null && (typeof fields.orderId !== 'string' || !ORDER_ID.test(fields.orderId)) ||
        fields.enabled && fields.orderId === null) return refuse('INVALID_INPUT', 'Use a revision, one order ID and an enabled flag.');
    if (this.fixedOrderId) return refuse('FIXED_ADMISSION', 'A fixed-order fixture cannot change admission.', 409);
    const current = this.read();
    if (fields.revision !== current.revision) return refuse('OUTDATED', 'Admission changed. Reload before retrying.', 409);
    // Once chosen, the order is pinned for this entire storage generation, even before intake.
    if (current.orderId !== null && current.orderId !== fields.orderId) return refuse('ORDER_PINNED', 'This generation is pinned to one order. Disable it without replacing its ID.', 409);
    if (current.orderId === fields.orderId && current.enabled === fields.enabled) return current;
    if (current.revision >= Number.MAX_SAFE_INTEGER) return refuse('REVISION_EXHAUSTED', 'Admission revision exhausted.', 409);
    if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE order_id != ? OR ? IS NULL', fields.orderId as string | null, fields.orderId as string | null).one().n) {
      return refuse('FOREIGN_ORDERS', 'Admission cannot adopt other orders.', 409);
    }
    this.sql.exec('UPDATE merchant_admission SET revision=?, order_id=?, enabled=?, updated_at=? WHERE id=1',
      current.revision + 1, fields.orderId as string | null, fields.enabled ? 1 : 0, new Date().toISOString());
    return this.read();
  }
}

/** Small, strict command body, independent of the larger ordinary Ship order endpoint. */
export async function admissionCommand(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return refuse('INVALID_INPUT', 'Use JSON.');
  const reader = request.body?.getReader(); if (!reader) return refuse('INVALID_INPUT', 'An admission command is required.');
  const bytes = new Uint8Array(2048); let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (length + value.length > bytes.length) return refuse('BODY_TOO_LARGE', 'Admission commands are limited to 2 KiB.', 413);
      bytes.set(value, length); length += value.length;
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, length))); }
    catch { return refuse('INVALID_INPUT', 'Use UTF-8 JSON.'); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
