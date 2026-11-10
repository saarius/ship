# Backroad Bum private Ship preparation

Merchant-only Node 24/workerd composition of the existing Ship service at source9a290bc. This is not a generic setup flow, upstream proposal or deployment of ship.dinkuskit.com. A separate merchant Registry sandbox profile connects the installed Ship admin to two read-only routes on this host. **Commerce intake remains unconnected and closed**; a verified admin connection is not fulfillment proof.

## Boundaries
- Fixed issuer/origin `https://backroadbum.com`, site `backroadbum`, separate audience `backroadbum-ship`; ES256 and distinct `ship:orders` / `ship:admin` scopes are checked before dispatch. Shared DinkusKit passes, Payments passes, another site and another site origin fail closed. The merchant issuer grants a distinct Ship plugin key only `ship:admin`, never `ship:orders`, Payments or Commerce settings.
- Admission is empty in `/etc/backroadbum/ship.json`0600. No order can enter, including existing paid orders. The configuration initializer never overwrites the file. A future admission requires a deliberately selected fresh canonical TEST order, receiver tests and coordinated Commerce controls; do not blindly enable generic sync over historical orders.
- Only an explicitly requested `kind: practice` operation can make a label. Practice PDFs read TEST - NOT POSTAGE, tracking starts TEST, postage price and delivery remain null. No Pitney Bowes credentials, account, email binding, hosted sign-in or tracking endpoint is permitted. Shopper email is discarded. No carrier/PB network exists: workerd may fetch only the merchant's exact public JWKS URL, with bounded response/time and no redirects.
- SQLite is stamped with the immutable origin/site/audience/generation/allowed-ID binding. It refuses foreign or populated generic storage and changes to admission. This is intentionally a closed preparation, **not** the retired `ship.sm0ky.dev` cohort. Do not revive that generic Commerce profile.
- Print links are the existing five-minute capabilities, scoped to a label and the fixed site. Do not log or publish them. Label creation is not dispatch/delivery, and no physical print is claimed.

## Build, prove, run
Use the service's locked dependencies: `cd service && npm ci --ignore-scripts`; when needed run the trusted installed esbuild/workerd installers explicitly. No manifest or lockfile changes are needed. The operational host loads Miniflare/esbuild from that lock; it is not part of any Registry artifact.

```sh
node --test ops/backroadbum/check.test.mjs
service/node_modules/.bin/tsc -p ops/backroadbum/tsconfig.json
(cd service && npm run typecheck && npm test)
node ops/backroadbum/runtime.mjs --build
sudo /opt/node/bin/node ops/backroadbum/configure.mjs
sudo chown agent:agent /etc/backroadbum/ship.json /var/lib/backroadbum/ship
# Install ops/backroadbum/backroadbum-ship.service under /etc/systemd/system, then enable/start.
curl -fsS http://127.0.0.1:8788/health
```

Tests use locally signed synthetic passes, temporary real SQLite Durable Objects and Ship's practice PDF. They cover scope/site/issuer/audience denial, closed admission, non-TEST/historical refusal, explicit practice action, duplicate-buy denial, print, persisted events across restart, ack, cancel and storage-binding refusal. Temporary fixture data is destroyed; it is not a paid Commerce order or live-store fulfillment proof.

`backroadbum-ship.service` runs independently of cycles, loopback8788, bounded memory and no public route. `/health` checks SQLite without creating an order/label/pass. Worker and data stay under `service/dist-backroadbum/` (ignored) and `/var/lib/backroadbum/ship/`0700. `configure.mjs` creates only empty admission and a fresh private print-token secret; it does not read or modify Stripe credentials.

## Read-only installed admin
`npm ci --ignore-scripts` at the repository root installs the locked plugin build tools. `node ops/backroadbum/build-plugin.mjs` stages the pinned source and overlays only the merchant entry/admin and fixed transport constants. Generic source and shared Connect stay unchanged. The official manifest/Registry size check runs; output is ignored at `dist/backroadbum/`. `node --test ops/backroadbum/plugin.test.mjs` checks the actual bundle. Its only route is private `POST admin`, permission `plugins:manage`, with an additional Administrator/surface/installation check. Unknown Connect, intake and label actions do no network work.

The store stages backend plus manifest at their combined content hash and mounts them through EmDash's workerd sandbox under Ship's existing installed ID. The encrypted `connection` setting holds only Ship's separate plugin key; the issuer configuration is `/etc/backroadbum/ship-grant.json`0600, initially disabled. The store's `node scripts/backroadbum-ship-admin.mjs --provision` explicitly saves it through the authenticated encrypted-settings API only when unset. The default command only verifies the page; `--expect-unavailable` checks the disabled-grant state. No key goes in ordinary KV, browser output, artifacts or logs.

Caddy exposes only GET `/api/ship/v1/admin/status` and `/api/ship/v1/admin/orders`, stripping `/api/ship` to loopback8788. Both require a verified `ship:admin` pass. No machine, label, print or setup route is public. The page trades a new pass on every refresh, checks the host's closed/practice/unconnected status and genuinely empty list, then renders facts with one Refresh action. Outages, foreign passes, unexpected orders or changed admission show unavailable, not an empty-success claim. To cut access, disable the grant; the next refresh fails. Already-issued passes last at most five minutes; remove the two proxy routes for an immediate cutoff. This is read-only access, not supported admission/rollback.

## Activation remains unfinished
Before admitting a real fresh TEST order: add a scoped Commerce transport that cannot send historical orders, a separate narrowly granted machine credential, and a protected merchant setup/action path. The read-only profile deliberately cannot display admitted orders; replace and re-prove it alongside that handoff. Local store snapshots now cover this workerd namespace's online SQLite copies, metadata and matching private Ship configuration/print secret; the isolated restore drill verifies startup and restart with issuer/provider network denied. The reusable synthetic fixture additionally recovers a practice label, its PDF capability and pending event. Runbook and checks live in `../template-store/BACKROADBUM.md` and `../template-store/ops/backroadbum/{backup.py,verify-ship-recovery.mjs,test_ship_recovery.mjs}` from the Ship repository root. Off-host recovery and other service keys remain unfinished; local recovery is not a full-store restore or an integration proof. Changing a file alone is not supported admission/rollback; immutable pin checks deliberately refuse it.
