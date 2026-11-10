// Merchant-only Registry sandbox artifact. Never publishes or modifies the generic plugin.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const pin = '9a290bcadc4d0a5ce5ba60d4dd7bd5637674b123';
const base = execFileSync('git', ['rev-parse', pin], { cwd: root, encoding: 'utf8' }).trim();
if (execFileSync('git', ['merge-base', 'HEAD', base], { cwd: root, encoding: 'utf8' }).trim() !== base) throw Error('merchant_ship_base_mismatch');
const stage = resolve(root, '.tmp/backroadbum-plugin');
rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
for (const file of execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)) {
  if (file.startsWith('ops/') || file.startsWith('service/') || file.startsWith('proof/') || file.startsWith('.grilltrack/')) continue;
  const target = resolve(stage, file); mkdirSync(dirname(target), { recursive: true }); cpSync(resolve(root, file), target);
}
symlinkSync(resolve(root, 'node_modules'), resolve(stage, 'node_modules'), 'dir');
for (const name of ['admin', 'plugin', 'practice-page']) cpSync(resolve(root, 'ops/backroadbum', name + '.ts'), resolve(stage, 'src', name + '.ts'));
const transport = resolve(stage, 'src/ship.ts'); let source = readFileSync(transport, 'utf8');
for (const [from, to] of [
  ['https://dinkuskit.com/api/store-passes', 'https://backroadbum.com/api/store-passes'],
  ['https://dinkuskit.com/account', 'https://backroadbum.com'],
  ['https://ship.dinkuskit.com', 'https://backroadbum.com/api/ship'],
  ['"dinkus-ship"', '"backroadbum-ship"'],
]) {
  if (source.split(from).length !== 2) throw Error('merchant_ship_transport_source_changed');
  source = source.replace(from, to);
}
writeFileSync(transport, source);
const manifestPath = resolve(stage, 'emdash-plugin.jsonc'); let manifest = readFileSync(manifestPath, 'utf8');
const hosts = /"allowedHosts":\s*\[[^\]]*\]/g;
if ([...manifest.matchAll(hosts)].length !== 1) throw Error('merchant_ship_manifest_source_changed');
manifest = manifest.replace(hosts, '"allowedHosts": ["backroadbum.com"]');
const description = 'Encrypted Store ID and this plugin\'s own DinkusKit store key. Managed by Connect on the Shipping page; don\'t change it here.';
if (manifest.split(description).length !== 2) throw Error('merchant_ship_setting_source_changed');
manifest = manifest.replace(description, 'Encrypted merchant Ship admin key. Provisioned by the Backroad Bum operator, not shared DinkusKit Connect.');
writeFileSync(manifestPath, manifest);
for (const args of [['run', 'typecheck'], ['run', 'build']]) execFileSync('npm', args, { cwd: stage, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=800' } });
const output = resolve(root, 'dist/backroadbum'); rmSync(output, { recursive: true, force: true });
cpSync(resolve(stage, 'dist'), resolve(output, 'dist'), { recursive: true });
const backend = readFileSync(resolve(output, 'dist/plugin.mjs'));
const profile = { profile: 'backroadbum/ship-practice-v2', base, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  origin: 'https://backroadbum.com', allowedHosts: ['backroadbum.com'], mode: 'test', bytes: backend.length,
  sha256: createHash('sha256').update(backend).digest('hex'),
  artifactSha256: createHash('sha256').update(backend).update(readFileSync(resolve(output, 'dist/manifest.json'))).digest('hex'),
  commerceConnected: false, published: false };
writeFileSync(resolve(output, 'profile.json'), JSON.stringify(profile, null, 2)); console.log(JSON.stringify(profile));
