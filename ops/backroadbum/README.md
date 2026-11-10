# Backroad Bum private Ship host

Merchant-only Node24/workerd composition of Ship at source9a290bc. This is not a generic setup flow, upstream proposal or shared-service deployment. A merchant Registry sandbox profile connects native EmDash admin checks and practice packing setup to this host. **Commerce intake remains unconnected and closed**; saved packing is not fulfillment proof.

## Boundaries
- Fixed issuer/origin `https://backroadbum.com`, site `backroadbum`, separate audience `backroadbum-ship`; ES256 and distinct `ship:orders`/`ship:admin` scopes are checked before dispatch. Shared DinkusKit passes, Payments passes, another site and another site origin fail closed. The issuer gives the Ship plugin’s separate encrypted key only `ship:admin`, never `ship:orders`, Payments or Commerce settings.
- Production admission remains empty and disabled; no order can enter, including historical paid orders. `/etc/backroadbum/ship.json`0600 still has an empty fixed order ID; its initializer never overwrites it. An additive SQLite control can reserve exactly one ID for the entire generation and enable/disable that ID using compare-and-set revisions. It is operator-only on loopback, not proxied or available to the plugin. No production ID has been selected.
- Only explicit `kind: practice` operations can make a label in this host; that API is not exposed publicly or by this admin profile. Practice PDFs say TEST - NOT POSTAGE; tracking starts TEST; postage and delivery remain null. No PB credentials, account, email binding, hosted sign-in or tracking endpoint can be configured. Shopper email is discarded; workerd may fetch only the exact merchant public JWKS, with bounded size/time and no redirects.
- SQLite retains its immutable origin/site/audience/generation/fixed-ID binding; foreign/populated generic storage and file-edited bindings are refused. Versioned admission lives separately in `merchant_admission`; it never rewrites that binding or permits replacing a chosen ID. Legacy fixed-order fixtures cannot use the dynamic control. This is not the retired shared isolated cohort. Editing a config file is NOT supported admission/rollback.
- Existing five-minute PDF capabilities stay label/site scoped and private. No print route is exposed. Label creation is not dispatch/delivery.

## Build and run
Use locked root/service dependencies (`npm ci --ignore-scripts`; run trusted esbuild/workerd installers explicitly if needed). Operational Node tooling is not part of a Registry artifact.

```sh
service/node_modules/.bin/tsc -p ops/backroadbum/tsconfig.json
node --test --test-concurrency=1 ops/backroadbum/check.test.mjs ops/backroadbum/packing.test.mjs ops/backroadbum/admission.test.mjs
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

## Versioned admission (operator-only; production remains closed)
Signed exact-site `ship:admin` GET/POST `/v1/admin/admission` on loopback reads/changes `{revision, orderId, enabled}`. POST requires UTF-8 JSON, exactly those fields and at most2KiB. A stale revision changes nothing. Once non-null, the selected ID cannot change or be cleared, even before intake or after disable; a different cohort requires a deliberate new generation, not a bulk-import loop. No selection silently enables intake and no API verifies that an arbitrary ID is a canonical Commerce order: the future operator integration must establish that fact before selection. Do not use this control to admit fixtures or historical orders in production.

Disabled admission refuses subsequent order writes, new practice labels, event pickup and ACK even with already-issued passes. An event fetched before disable may already have reached Commerce; the future sender must independently re-admit current configuration before completion/ACK. In-flight calls may drain. Local practice label creation holds the DO input gate across its reads and label/event write, so disable cannot commit halfway through it. Pending labels/events remain stored for same-order re-enable; disable neither deletes data nor revokes an already-minted private print capability. No live postage or email can be configured.

`node ops/backroadbum/check-admission.mjs` is a read-only production closed-state check. It verifies no selected ID, revision0, empty intake, unchanged packing when `BACKROADBUM_PACKING_BASELINE` names an earlier report, and404 for public control/machine paths. It prints only allowlisted facts and a packing hash. `--expect-legacy` checks the pre-migration host without mutating it. No selection/enable CLI or native action is shipped yet. The existing packing-only UI deliberately refuses a generation after any ID is selected; activation requires its successor UI and canonical Commerce integration.

Old fixed-profile storage is migrated additively on restart, preserving packing. A present-but-missing/corrupt admission row fails closed rather than being silently reset. While production stays unselected, rollback to the earlier worker leaves intake closed and merely ignores the additive table; never use rollback to erase a selection or disable history.

## Dogfood and recovery
Store `node scripts/backroadbum-ship-packing.mjs` is read-only. Explicit `--save-demo` populates only empty/exact demo state; `--exercise` tests invalid input and adds/removes a temporary box. Neither creates orders/labels. These are merchant settings, not physical measurements of real gear.

Local store snapshots cover online Ship SQLite, namespace metadata and matching private print config. The isolated restore drill and synthetic disabled-admission/label/PDF/pending-event proof live in `../template-store/ops/backroadbum/{backup.py,verify-ship-recovery.mjs,test_ship_recovery.mjs}`; runbook is `../template-store/BACKROADBUM.md`. Snapshots contain a secret: never public/git. Off-host/full-store/other-service-key recovery remains unfinished. Before activation, add bounded canonical Commerce intake/current/disable/event ACK and protected label actions, then prove one fresh paid TEST order. No historical bulk import or revival of the retired shared cohort.
