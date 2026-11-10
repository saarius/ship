// Initialize a closed, empty merchant host. Never overwrite a private configuration.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { validateConfig } from './runtime.mjs';
process.umask(0o077);
const path = '/etc/backroadbum/ship.json';
if (existsSync(path)) {
  const config = validateConfig(JSON.parse(readFileSync(path, 'utf8')));
  if (config.allowedOrderId !== '') throw Error('existing_admission_is_not_closed');
  console.log('Private Ship configuration already exists and is closed; unchanged.');
} else {
  writeFileSync(path, JSON.stringify({ schema: 'backroadbum.ship-node/v1', generation: 'practice-preparation-v1', allowedOrderId: '',
    sessionSecret: randomBytes(48).toString('base64url') }), { mode: 0o600, flag: 'wx' });
  console.log('Private Ship configuration created; admission closed.');
}
mkdirSync('/var/lib/backroadbum/ship', { recursive: true, mode: 0o700 });
