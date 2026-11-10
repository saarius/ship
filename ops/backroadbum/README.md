# Backroad Bum private Ship host

Merchant-only Node24/workerd composition of Ship at source9a290bc, with a Registry sandbox admin profile. This is not a generic setup flow, upstream proposal or shared-service deployment. **Production remains unselected at revision0; Commerce sends no orders.** Synthetic tests are not merchant fulfillment proof.

## Boundaries
- Fixed issuer/origin `https://backroadbum.com`, site `backroadbum`, audience `backroadbum-ship`; ES256, exact site/origin and distinct `ship:orders`/`ship:admin` scopes are checked before dispatch. Foreign/shared/Payments passes fail closed. Ship’s separate encrypted plugin key receives only `ship:admin`, never order intake, Payments or Commerce settings.
- SQLite retains its immutable origin/site/audience/generation/fixed-ID binding. Populated generic storage, foreign bindings and file-edited configuration are refused. Admission is additive and versioned; a selected ID is pinned for its generation, including after disable. Legacy fixed-ID fixtures cannot change it.
- Only explicit practice labels are possible. No PB credentials, account, email binding, hosted sign-in or tracking endpoint can be configured. PDFs say TEST - NOT POSTAGE; references start TEST; postage/delivery remain null. Shopper email is discarded. Workerd may fetch only the exact merchant public JWKS with bounded time/size and no redirects.
- Public machine/control/hosted routes remain404. An arbitrary selected ID is not a canonical paid-order check. A Commerce sender/current/disable/event-ACK contract and fresh paid TEST-order proof are required before production selection.

## Build and run
Locked root/service dependencies are required; operational Node tooling never enters a Registry artifact.

```sh
service/node_modules/.bin/tsc -p ops/backroadbum/tsconfig.json
node --test --test-concurrency=1 ops/backroadbum/{check,packing,admission,practice}.test.mjs
(cd service && npm run typecheck && npm test)
npm test
node ops/backroadbum/runtime.mjs --build
node ops/backroadbum/build-plugin.mjs
node --test ops/backroadbum/plugin.test.mjs
# First install only: sudo node ops/backroadbum/configure.mjs; grant agent0600/0700 access.
# Install backroadbum-ship.service under /etc/systemd/system; enable/start independently.
curl -fsS http://127.0.0.1:8788/health
```

Loopback8788 serves the ignored `service/dist-backroadbum/` worker with0700 persistence under `/var/lib/backroadbum/ship/`. Health reads SQLite without creating an order, label, pass or provider call. Run recovery tools with the Ship repo as cwd because workerd resolves module paths there.

## Native admin
`build-plugin.mjs` stages the pinned source, overlays merchant entry/admin/view/transport and runs official typecheck/build/Registry-size checks. Generic Connect remains unchanged. Ignored output `dist/backroadbum/` declares `backroadbum/ship-practice-v2`; the store checks backend+manifest at their combined hash before mounting the existing installed identity.

The sole plugin route is private POST `admin`, `plugins:manage`, with an additional Administrator/surface/exact-installation check. Encrypted `connection` holds only the separate Ship key. Store `node scripts/backroadbum-ship-admin.mjs --provision` saves it only when unset; default checks the closed native view. Each invocation trades a fresh admin pass, with no pass cache or browser credentials. Unknown Connect/intake/postage/control actions dispatch nothing.

Unselected production retains the existing connection/empty-state and separate packing view. Origin and box forms name units, retain invalid typed values and confirm success only after checked responses. An uncertain save offers reload/inspection rather than replay; box addition is not idempotent. No box is built in. After any selection, packing remains readable but edits freeze, including across the selection/save race through the DO input gate.

The selected-order view reads only the pinned order. It distinguishes not received, disabled, Processing, Completed and stored practice-label states. Full address and tracking use wrapping native sections rather than phone-truncated fact fields. The label form names a saved box and total packed weight; it carries the admission revision and order version. It never accepts a user-supplied provider, kind, service, actor, label ID or re-buy flag. The plugin supplies the authenticated actor; the host forces practice/GA and rechecks enabled admission, revision, order ID, TEST mode and version under its input gate.

At most one label ever can be created through this UI. Duplicate/lost-response/version-change retries cannot create a second one, even after cancellation. There is intentionally no cancel/re-buy UI yet. Successful creation reloads the durable record; uncertain creation does not auto-retry. A separate Prepare print link action derives the label from the selected order, checks the same current state and mints a five-minute site+label-scoped capability. Existing capabilities survive disable until expiry. Labels/events are retained; creating or printing a label does not itself complete Commerce or imply dispatch/delivery.

## Exact proxy routes
`template-store/ops/backroadbum/ship-proxy.caddy` exposes:
- GET status/orders/practice-order, and GET/POST practice-settings under `/api/ship/v1/admin/`.
- POST `/api/ship/v1/admin/practice-label`, requiring a strict2KiB JSON create/print command.
- GET `/api/ship/print/<capability>` for existing private PDFs; no owner session or hosted page.

All admin routes require signed exact-site/origin `ship:admin`. Packing input is limited to16KiB and existing Ship validators. The dedicated label command rejects unknown fields/actions; it cannot change admission. All other paths/methods are404. No production label or print capability has been created.

Issuer `/etc/backroadbum/ship-grant.json`0600 is read at every exchange. Disable it to stop the next page/action; existing passes can last5min. Remove the proxy import for immediate HTTP cutoff. Admission disable blocks new labels and print-link issuance even with old passes, but does not revoke existing print links or calls already dispatched. No key enters ordinary KV, browser output, git or logs. Addresses stay in authenticated admin, private SQLite and snapshots, never the dashboard.

## Operator-only admission
Signed GET/POST `/v1/admin/admission` on loopback reads/changes `{revision, orderId, enabled}`. POST is strict UTF-8 JSON, exactly those fields, at most2KiB. A stale revision changes nothing; a chosen ID cannot be replaced or cleared. No selection/enable CLI or native control is shipped. `/etc/backroadbum/ship.json` retains its empty fixed ID; editing it is not supported activation or rollback.

Disable refuses subsequent intake, labels, print-link issuance, event pickup and ACK, including old passes. Practice writes hold the input gate so disable cannot commit halfway through them. Previously dispatched calls/responses may drain; the future Commerce sender must independently re-admit current configuration before completion/ACK. Pending events recover on same-order re-enable. Production activation must not adopt fixtures, historical orders or the retired shared isolated cohort.

`node ops/backroadbum/check-admission.mjs` is a read-only production revision0/empty/packing-hash/public-denials check. `BACKROADBUM_PACKING_BASELINE` names an earlier report for comparison; `--expect-legacy` checks the old host. Missing/corrupt admission rows fail closed. Older snapshots without the additive table migrate while preserving packing. Never roll back to erase selection/disable history.

## Recovery and remaining work
Store snapshots include online Ship SQLite, namespace metadata and matching private print config. The isolated restore drill and synthetic disabled-admission/label/PDF/pending-event proof live in `../template-store/ops/backroadbum/`; runbook is `../template-store/BACKROADBUM.md`. Snapshots contain a secret: never public/git. Store packing dogfood tooling is read-only unless explicitly saving an empty/exact demo setup.

Next: bounded canonical Commerce sender/current/disable/event ACK and replacement of its unsupported hosted-label links. Only then select a deliberately fresh paid TEST order and prove intake → native label → Commerce completion → guest receipt. Off-host/full-store/other-service-key recovery remains unfinished. Reconsider the one-label UI limit only when a real recovery case requires a separately verified cancel/replacement contract.
