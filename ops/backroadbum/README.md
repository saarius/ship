# Backroad Bum private Ship host

Merchant-only Node24/workerd composition of Ship at source9a290bc. This is not a generic setup flow, upstream proposal or shared-service deployment. A merchant Registry sandbox profile connects native EmDash admin checks and practice packing setup to this host. **Commerce intake remains unconnected and closed**; saved packing is not fulfillment proof.

## Boundaries
- Fixed issuer/origin `https://backroadbum.com`, site `backroadbum`, separate audience `backroadbum-ship`; ES256 and distinct `ship:orders`/`ship:admin` scopes are checked before dispatch. Shared DinkusKit passes, Payments passes, another site and another site origin fail closed. The issuer gives the Ship plugin’s separate encrypted key only `ship:admin`, never `ship:orders`, Payments or Commerce settings.
- Admission is empty in `/etc/backroadbum/ship.json`0600; no order can enter, including historical paid orders. Its initializer never overwrites the file. Origin/box saves do not change this configuration, the issuer, provider, generation or admission.
- Only explicit `kind: practice` operations can make a label in this host; that API is not exposed publicly or by this admin profile. Practice PDFs say TEST - NOT POSTAGE; tracking starts TEST; postage and delivery remain null. No PB credentials, account, email binding, hosted sign-in or tracking endpoint can be configured. Shopper email is discarded; workerd may fetch only the exact merchant public JWKS, with bounded size/time and no redirects.
- SQLite is stamped with immutable origin/site/audience/generation/allowed-ID binding; foreign/populated generic storage and changed admission are refused. This is not the retired shared isolated cohort. Editing a config file is NOT supported admission/rollback.
- Existing five-minute PDF capabilities stay label/site scoped and private. No print route is exposed. Label creation is not dispatch/delivery.

## Build and run
Use locked root/service dependencies (`npm ci --ignore-scripts`; run trusted esbuild/workerd installers explicitly if needed). Operational Node tooling is not part of a Registry artifact.

```sh
service/node_modules/.bin/tsc -p ops/backroadbum/tsconfig.json
node --test --test-concurrency=1 ops/backroadbum/check.test.mjs ops/backroadbum/packing.test.mjs
(cd service && npm run typecheck && npm test)
node ops/backroadbum/runtime.mjs --build
node ops/backroadbum/build-plugin.mjs
node --test ops/backroadbum/plugin.test.mjs
# First install only: sudo node ops/backroadbum/configure.mjs; then give agent0600/0700 access.
# Install backroadbum-ship.service under /etc/systemd/system and enable/start.
curl -fsS http://127.0.0.1:8788/health
```

The service runs independently of agent cycles on loopback8788. Worker/data live under ignored `service/dist-backroadbum/` and `/var/lib/backroadbum/ship/`0700. Health checks SQLite without creating an order, label, pass or provider call. Temporary synthetic tests cover the practice lifecycle, restart/event ACK and packing validation/persistence, not paid store fulfillment.

## Native admin and packing
`build-plugin.mjs` stages the pinned source and overlays merchant entry/admin/transport only; generic Connect stays unchanged. Official typecheck/build/Registry size checks run. Output is ignored under `dist/backroadbum/`; the store verifies and stages backend+manifest at their combined hash before mounting Ship’s existing installed identity. Profile `backroadbum/ship-packing-v1` deliberately refuses changed admission or nonempty orders.

The only plugin route is private `POST admin`, `plugins:manage`, with an additional Administrator/surface/exact-installation check. Unknown Connect, intake and label actions do no network work. The encrypted `connection` setting holds only the separate Ship plugin key. Store `node scripts/backroadbum-ship-admin.mjs --provision` saves it only if unset; default only reads the status view. `--expect-unavailable` checks a disabled grant. No key enters browser output, ordinary KV, git or logs.

The page trades a fresh pass for every load/action, checks closed/practice/unconnected status and an empty order list, then reads packing. Packing setup is a separate native view: origin form, saved boxes table and add-box form. Units are explicit, invalid input is retained and successful saves are rendered only after checked responses. Address replacement/removal can repeat; box add is not idempotent. An uncertain save offers reload/inspection before retry, never automatic replay. No box is built in or silently seeded.

Caddy exposes only GET `/api/ship/v1/admin/status`, GET `/api/ship/v1/admin/orders`, and GET/POST `/api/ship/v1/admin/practice-settings`, stripping `/api/ship`. Every call requires signed exact-site/origin `ship:admin`. The packing endpoint additionally requires closed intake, limits JSON to16KiB, rejects extra fields/control text/non-string fields, then invokes existing Ship origin/box validators. Its response contains only schema, origin and boxes—no postage, account, reply-to or print settings. Origin addresses remain private to authenticated admin, SQLite and private snapshots; they are not public dashboard evidence.

Issuer `/etc/backroadbum/ship-grant.json`0600 is read each exchange. Disable it to stop the next admin load/save; existing passes last at most5min. Remove the proxy import for immediate cutoff. The exact public JWKS route exposes only the existing public ES256 key; no signing key is shared. No grant scope or issuer code changed for packing setup.

## Dogfood and recovery
Store `node scripts/backroadbum-ship-packing.mjs` is read-only. Explicit `--save-demo` populates only empty/exact demo state; `--exercise` tests invalid input and adds/removes a temporary box. Neither creates orders/labels. These are merchant settings, not physical measurements of real gear.

Local store snapshots cover online Ship SQLite, namespace metadata and matching private print config. The isolated restore drill and synthetic label/PDF/event proof live in `../template-store/ops/backroadbum/{backup.py,verify-ship-recovery.mjs,test_ship_recovery.mjs}`; runbook is `../template-store/BACKROADBUM.md`. Snapshots contain a secret: never public/git. Off-host/full-store/other-service-key recovery remains unfinished. Before activation, add bounded canonical Commerce intake/current/disable/event ACK and protected label actions, then prove one fresh paid TEST order. No historical bulk import or revival of the retired shared cohort.
