// Merchant-only composition. Generic Registry plugin and hosted Ship stay unchanged.
import { StoreShipping } from '../../service/src/store.js';
import { handle } from '../../service/src/worker.js';
import { createAuthenticator } from '../../service/src/auth.js';
import { openPrintLink, mintPrintLink } from '../../service/src/session.js';
import { showAdminOrder } from '../../service/src/admin.js';
import { practiceCommand, type PracticeCommand } from './practice.js';
import { ServiceError, ok, toOutcome, type Outcome } from '../../service/src/errors.js';
import { packingSettings } from './packing.js';
import { MerchantAdmission, admissionCommand } from './admission.js';

interface MerchantEnv extends Env { MERCHANT_GENERATION: string; MERCHANT_ALLOWED_ORDER_ID: string }
const ORIGIN = 'https://backroadbum.com', SITE = 'backroadbum', AUDIENCE = 'backroadbum-ship';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const denied = () => ({ ok: false as const, status: 403, code: 'FORBIDDEN', message: 'This practice-label host does not admit the operation.' });
export function configuration(env: MerchantEnv): void {
  if (env.ACCOUNT_ISSUER !== ORIGIN || env.ACCOUNT_AUDIENCE !== AUDIENCE || env.ACCOUNT_JWKS_URL !== ORIGIN + '/.well-known/jwks.json' ||
      typeof env.MERCHANT_GENERATION !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(env.MERCHANT_GENERATION) || typeof env.MERCHANT_ALLOWED_ORDER_ID !== 'string' ||
      !/^[A-Za-z0-9._:-]{0,200}$/.test(env.MERCHANT_ALLOWED_ORDER_ID) || typeof env.SHIP_SESSION_SECRET !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(env.SHIP_SESSION_SECRET) ||
      env.PB_ENVIRONMENT !== 'off' || Object.entries(env).some(([key, value]) =>
        ((key.startsWith('PB_') && key !== 'PB_ENVIRONMENT') || key.startsWith('SHIP_') && key !== 'SHIP_STORES' && key !== 'SHIP_SESSION_SECRET' ||
          key === 'EMAIL' || key === 'ACCOUNT_SIGNIN_URL' || key === 'ACCOUNT_TOKEN_URL') && Boolean(value))) {
    throw new Error('merchant_practice_configuration_required');
  }
}

/** Stamp all storage before use; never adopt generic Ship data or another admission. */
export class MerchantStoreShipping extends StoreShipping {
  private readonly merchantAdmission: MerchantAdmission;
  constructor(ctx: DurableObjectState, env: MerchantEnv) {
    configuration(env);
    super(ctx, env);
    const sql = ctx.storage.sql;
    const binding = JSON.stringify([ORIGIN, SITE, AUDIENCE, env.MERCHANT_GENERATION, env.MERCHANT_ALLOWED_ORDER_ID, 'practice']);
    sql.exec('CREATE TABLE IF NOT EXISTS merchant_profile (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL)');
    const kept = sql.exec<{ binding: string }>('SELECT binding FROM merchant_profile WHERE id=1').toArray()[0];
    if (kept && kept.binding !== binding) throw new Error('merchant_storage_binding_mismatch');
    if (!kept) {
      for (const table of ['orders', 'labels', 'label_events', 'purchases', 'sessions', 'boxes', 'store_meta', 'shipped_emails', 'tracking_work']) {
        if (sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n) throw new Error('merchant_storage_must_start_empty');
      }
      sql.exec('INSERT INTO merchant_profile VALUES (1, ?)', binding);
    }
    this.merchantAdmission = new MerchantAdmission(sql, env.MERCHANT_ALLOWED_ORDER_ID);
  }
  async getMerchantAdmission() { return this.merchantAdmission.read(); }
  async changeMerchantAdmission(input: unknown): Promise<Outcome> {
    try { return ok(this.ctx.storage.transactionSync(() => this.merchantAdmission.change(input))); }
    catch (error) { return toOutcome(error); }
  }
  override async receiveOrder(body: unknown, admission: Record<string, unknown> = {}): Promise<Outcome> {
    const state = this.merchantAdmission.read();
    if (!state.enabled || !body || typeof body !== 'object' ||
        (body as { orderId?: unknown }).orderId !== state.orderId || (body as { test?: unknown }).test !== true) return denied();
    // Practice labels do not need a shopper email. No email service can be configured here.
    return super.receiveOrder({ ...body, email: null }, admission);
  }
  override async buyLabel(input: Parameters<StoreShipping['buyLabel']>[0]): Promise<Outcome> {
    // Practice label creation awaits local reads. Hold the DO input gate so a disable
    // cannot commit between admission and the label/event write. No provider I/O occurs.
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = this.merchantAdmission.read();
      if (!state.enabled || input.orderId !== state.orderId || input.fields.kind !== 'practice') return denied();
      return super.buyLabel(input);
    });
  }
  override async listLabels(admission: Record<string, unknown> = {}): Promise<Outcome> {
    const state = this.merchantAdmission.read();
    if (state.orderId && !state.enabled) return denied();
    return super.listLabels(admission);
  }
  override async ackLabel(body: unknown, admission: Record<string, unknown> = {}): Promise<Outcome> {
    const state = this.merchantAdmission.read();
    const eventId = body && typeof body === 'object' ? (body as { eventId?: unknown }).eventId : null;
    if (!state.enabled || typeof eventId !== 'string' || !this.ctx.storage.sql.exec(
      'SELECT 1 FROM label_events WHERE event_id=? AND order_id=?', eventId, state.orderId).toArray().length) return denied();
    return super.ackLabel(body, admission);
  }
  async merchantPacking(action: string, fields: Record<string, string>): Promise<Outcome> {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.merchantAdmission.read().orderId) return denied();
      return action === 'ship-from' ? super.saveShipFrom(fields) : action === 'add-box' ? super.addBox(fields) : super.removeBox(fields.boxId!);
    });
  }
  async merchantPracticeCommand(command: PracticeCommand): Promise<Outcome> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = this.merchantAdmission.read();
      if (!state.enabled || state.orderId !== command.orderId) return denied();
      if (state.revision !== command.revision) return { ok: false, status: 409, code: 'OUTDATED', message: 'Admission changed. Reload before retrying.' };
      const summary = await this.orderSummary(command.orderId);
      if (!summary || !summary.order.test || summary.order.version !== command.version) return { ok: false, status: 409, code: 'OUTDATED', message: 'Order changed or is not available. Reload before retrying.' };
      if (command.action === 'print') {
        // Never accept a browser-provided label ID or mint for another order.
        const label = summary.labels[0];
        if (summary.labels.length !== 1 || !label || !label.practice || !label.test || label.status !== 'bought') return denied();
        const exp = Math.floor(Date.now() / 1000) + 300;
        const token = await mintPrintLink(this.env, { site: SITE, labelId: label.labelId, exp });
        return ok({ url: ORIGIN + '/api/ship/print/' + token, expiresAt: new Date(exp * 1000).toISOString() });
      }
      // One label ever through this UI, even after an order-version update or cancellation.
      // A lost response is recovered by reading, never by automatically buying again.
      if (summary.labels.length) return { ok: false, status: 409, code: 'ALREADY_LABELED', message: 'A label record already exists. Reload to inspect it.' };
      return super.buyLabel({ orderId: command.orderId, uid: 'admin:' + command.by!.trim(), fields: {
        version: String(command.version), boxId: command.boxId!, weightOz: String(command.weightOz!), kind: 'practice', service: 'GA',
      } });
    });
  }
  protected override emailSender(): null { return null; }
}

let auth: ReturnType<typeof createAuthenticator> | undefined;
export default { async fetch(request: Request, env: MerchantEnv): Promise<Response> {
  try {
    configuration(env);
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || url.search) return json({ error: 'unexpected_input' }, 400);
    if (url.pathname === '/health' && request.method === 'GET') {
      // A non-creating storage probe: no order, pass, label, provider call or email.
      const store = env.SHIP_STORES.get(env.SHIP_STORES.idFromName(SITE)) as unknown as DurableObjectStub<MerchantStoreShipping>;
      await store.getSettings();
      const state = await store.getMerchantAdmission();
      return json({ schema: 'backroadbum.ship-health/v1', mode: 'test', provider: 'practice',
        admission: state.enabled ? 'selected-order' : 'closed', commerceConnected: false });
    }
    if (/^\/print\/[A-Za-z0-9_.-]+$/.test(url.pathname) && request.method === 'GET') {
      const link = await openPrintLink(env, url.pathname.slice('/print/'.length));
      if (!link || link.site !== SITE) return json({ error: 'expired_print_link' }, 410);
      return handle(request, env);
    }
    const machine = ['/v1/orders', '/v1/labels', '/v1/labels/ack'].includes(url.pathname);
    const admin = url.pathname === '/v1/admin/practice-order' || url.pathname === '/v1/admin/practice-label' || url.pathname === '/v1/admin/status' || url.pathname === '/v1/admin/admission' || url.pathname === '/v1/admin/practice-settings' || /^\/v1\/admin\/(?:orders(?:\/[A-Za-z0-9._:%-]+(?:\/(?:prices|labels))?)?|labels\/[A-Za-z0-9._:%-]+\/(?:cancel|print-link))$/.test(url.pathname);
    if (!machine && !admin) return json({ error: 'not_found' }, 404);
    auth ??= createAuthenticator({ issuer: ORIGIN, audience: AUDIENCE, jwksUrl: ORIGIN + '/.well-known/jwks.json' });
    const principal = await auth(request, machine ? 'ship:orders' : 'ship:admin');
    if (principal.siteId !== SITE || principal.siteOrigin !== ORIGIN) return json({ error: 'forbidden' }, 403);
    // This private namespace binds the subclass; upstream Env still names StoreShipping.
    const store = env.SHIP_STORES.get(env.SHIP_STORES.idFromName(SITE)) as unknown as DurableObjectStub<MerchantStoreShipping>;
    if (url.pathname === '/v1/admin/status') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const state = await store.getMerchantAdmission();
      return json({ schema: 'backroadbum.ship-admin/v1', mode: 'test', provider: 'practice',
        admission: state.enabled ? 'selected-order' : 'closed', commerceConnected: false });
    }
    if (url.pathname === '/v1/admin/practice-order') {
      if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
      const admission = await store.getMerchantAdmission();
      const result = admission.orderId ? await showAdminOrder(store, admission.orderId).catch(error => {
        if (error instanceof ServiceError && error.status === 404) return ok({ order: null });
        throw error;
      }) : ok({ order: null });
      if (!result.ok) return json({ error: result.code }, result.status);
      return json({ schema: 'backroadbum.ship-practice/v1', admission, ...(result.body as object) });
    }
    if (url.pathname === '/v1/admin/practice-label') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const result = await store.merchantPracticeCommand(await practiceCommand(request)) as unknown as Outcome;
      return result.ok ? json(result.body, result.status) : json({ error: { code: result.code, message: result.message } }, result.status);
    }
    // Operator-only for now: no Caddy route or plugin action exposes this control.
    if (url.pathname === '/v1/admin/admission') {
      if (request.method === 'GET') return json(await store.getMerchantAdmission());
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const result = await store.changeMerchantAdmission(await admissionCommand(request)) as unknown as Outcome;
      return result.ok ? json(result.body, result.status) : json({ error: { code: result.code, message: result.message } }, result.status);
    }
    if (url.pathname === '/v1/admin/practice-settings') {
      // Packing inspection stays available after selection; freeze edits for this one-order generation.
      if (request.method !== 'GET' && (await store.getMerchantAdmission()).orderId) return json({ error: 'packing_profile_closed_intake_required' }, 403);
      return packingSettings(request, store, async (action, fields) => await store.merchantPacking(action, fields) as unknown as Outcome);
    }
    return handle(request, env);
  } catch (error) {
    if (error instanceof ServiceError) return json({ error: error.code }, error.status);
    // Storage/runtime exceptions must not disclose secrets or customer data.
    return json({ error: 'ship_unavailable' }, 503);
  }
} };
