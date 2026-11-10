# Backroad Bum private Ship preparation

Merchant-only Node 24/workerd composition of the existing Ship service at source9a290bc. This is not a generic setup flow, Registry plugin replacement, upstream proposal or deployment of ship.dinkuskit.com. The store still mounts Ship0.3.1 and is **not connected** to this host. No Commerce setting, issuer grant or public proxy was changed.

## Boundaries
- Fixed issuer/origin `https://backroadbum.com`, site `backroadbum`, separate audience `backroadbum-ship`; ES256 and distinct `ship:orders` / `ship:admin` scopes are checked before dispatch. Shared DinkusKit passes, Payments passes, another site and another site origin fail closed.
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

## Activation remains unfinished
Before admitting a real fresh TEST order: add coherent per-plugin issuer grants, a merchant Registry Ship build with exact-host access, a scoped Commerce transport that cannot send historical orders, and a protected merchant setup/action path. Extend online SQLite backup/recovery to the new workerd persistence tree and preserve the private print secret off-host. Current store backups cover Commerce/Payments, **not** this empty preparatory host. Changing a file alone is not supported admission/rollback; immutable pin checks deliberately refuse it.
