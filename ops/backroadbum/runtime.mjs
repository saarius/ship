// Private Node/workerd host for Ship's existing SQLite Durable Object and practice PDF.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../service/package.json', import.meta.url));
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = require('miniflare');
const ORIGIN = 'https://backroadbum.com';
export const bundle = new URL('../../service/dist-backroadbum/worker.mjs', import.meta.url).pathname;
export function validateConfig(config) {
  if (!config || Object.keys(config).sort().join() !== 'allowedOrderId,generation,schema,sessionSecret' ||
      config.schema !== 'backroadbum.ship-node/v1' || typeof config.generation !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.generation) ||
      typeof config.allowedOrderId !== 'string' || !/^[A-Za-z0-9._:-]{0,200}$/.test(config.allowedOrderId) ||
      typeof config.sessionSecret !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(config.sessionSecret)) throw Error('invalid_ship_configuration');
  return config;
}
export async function build() {
  await require('esbuild').build({ entryPoints: [new URL('./worker.ts', import.meta.url).pathname], outfile: bundle,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*', 'node:*'], minify: true });
}
export async function createPracticeHost({ config, stateDir, fetchJwks = fetch }) {
  validateConfig(config);
  if (stateDir) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  let allowedFetches = 0, refusedFetches = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, cf: false,
    log: new Log(LogLevel.NONE), logRequests: false, telemetry: { enabled: false },
    ...(stateDir ? { resourcePersistencePath: stateDir } : {}),
    workers: [{ name: 'backroadbum-ship-practice', modules: true, scriptPath: bundle,
      compatibilityDate: '2026-09-29', compatibilityFlags: ['nodejs_compat'],
      durableObjects: { SHIP_STORES: { className: 'MerchantStoreShipping', useSQLite: true, unsafeUniqueKey: 'backroadbum-ship-practice-v1' } },
      bindings: { ACCOUNT_ISSUER: ORIGIN, ACCOUNT_AUDIENCE: 'backroadbum-ship', ACCOUNT_JWKS_URL: ORIGIN + '/.well-known/jwks.json',
        SHIP_SESSION_SECRET: config.sessionSecret, PB_ENVIRONMENT: 'off',
        MERCHANT_GENERATION: config.generation, MERCHANT_ALLOWED_ORDER_ID: config.allowedOrderId },
      outboundService: async request => {
        if (request.method !== 'GET' || request.url !== ORIGIN + '/.well-known/jwks.json') {
          refusedFetches++; return new Response('External network unavailable', { status: 503 });
        }
        allowedFetches++;
        try {
          const response = await fetchJwks(ORIGIN + '/.well-known/jwks.json', { redirect: 'error', signal: AbortSignal.timeout(5000) });
          if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 65536) throw Error('jwks_unavailable');
          const chunks = []; let size = 0;
          for await (const chunk of response.body) { size += chunk.length; if (size > 65536) throw Error('jwks_too_large'); chunks.push(Buffer.from(chunk)); }
          return new Response(Buffer.concat(chunks), { headers: { 'content-type': 'application/json' } });
        } catch { return new Response('Issuer unavailable', { status: 503 }); }
      },
    }],
  }));
  const host = { mf, fetch: (path, init) => mf.dispatchFetch(ORIGIN + path, init), dispose: () => mf.dispose(),
    network: () => ({ allowedFetches, refusedFetches }) };
  try {
    if ((await host.fetch('/health')).status !== 200) throw Error('ship_storage_unavailable');
    return host;
  } catch (error) { await mf.dispose(); throw error; }
}

export function loopbackServer(host) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400).end(); return; }
      const chunks = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > 256 * 1024) { outgoing.writeHead(413).end(); return; } chunks.push(chunk); }
      const response = await host.fetch(incoming.url, { method: incoming.method, headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) && chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 64;
  return server;
}
async function main() {
  process.umask(0o077);
  if (process.argv.includes('--build')) { await build(); console.log('Merchant Ship worker built; no deployment or provider call.'); return; }
  const config = validateConfig(JSON.parse(readFileSync('/etc/backroadbum/ship.json', 'utf8')));
  const host = await createPracticeHost({ config, stateDir: '/var/lib/backroadbum/ship' });
  const server = loopbackServer(host);
  server.listen(8788, '127.0.0.1', () => console.log('Private Ship practice host listening; commerce connection not enabled.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await host.dispose(); process.exit(0); }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error('Private Ship startup refused; inspect configuration and storage binding.'); process.exitCode = 1;
});
