#!/usr/bin/env node
/**
 * Verifies that `pnpm build` produced a loadable unpacked MV3 extension:
 * files Chrome resolves, icon dimensions, no bundled replacement media, and
 * no unexplained external URLs in the shipped code.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dist = resolve(process.cwd(), 'dist');
const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

if (!existsSync(dist)) {
  console.error('dist/ missing — run `pnpm build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
check(manifest.manifest_version === 3, 'manifest_version must be 3');
check(manifest.background?.type === 'module', 'background must be a module service worker');

const required = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
];
for (const file of required) {
  check(typeof file === 'string' && existsSync(join(dist, file)), `missing manifest file ${file}`);
}

for (const [size, file] of Object.entries(manifest.icons ?? {})) {
  if (typeof file !== 'string' || !existsSync(join(dist, file))) continue;
  const data = readFileSync(join(dist, file));
  check(data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${file} is not a PNG`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  check(width === Number(size) && height === Number(size), `${file} is ${width}x${height}, expected ${size}x${size}`);
}

for (const page of [manifest.action?.default_popup, manifest.options_ui?.page]) {
  if (typeof page !== 'string') continue;
  const html = readFileSync(join(dist, page), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (ref.startsWith('http') || ref.startsWith('data:')) continue;
    const file = ref.replace(/^\//, '');
    check(existsSync(join(dist, file)), `${page} references missing ${ref}`);
  }
}

const content = readFileSync(join(dist, manifest.content_scripts[0].js[0]), 'utf8');
check(!/^\s*import[\s("']/m.test(content), 'content.js must be a self-contained IIFE (found import)');

const background = readFileSync(join(dist, manifest.background.service_worker), 'utf8');
for (const match of background.matchAll(/from\s*["']\.\/([^"']+)["']/g)) {
  check(existsSync(join(dist, match[1])), `background.js imports missing ${match[1]}`);
}

// US-014: user media lives in IndexedDB. No replacement art may be bundled.
check(
  !existsSync(join(dist, 'assets', 'replacements')),
  'dist/assets/replacements must not exist: replacement media is user-supplied',
);
for (const file of [manifest.background.service_worker, manifest.content_scripts[0].js[0]]) {
  const source = readFileSync(join(dist, file), 'utf8');
  check(!source.includes('assets/replacements'), `${file} references bundled replacements`);
}

// No new external URLs in shipped code. Known, intentional endpoints only.
const ALLOWED_URL_PATTERNS = [
  /^https:\/\/openrouter\.ai\//,
  /^https:\/\/github\.com\/moomooskycow\/polymorph$/,
  /^http:\/\/www\.w3\.org\/2000\/svg$/,
];
const assetDirs = [
  join(dist, 'assets'),
  join(dist, 'icons'),
];
const jsFiles = [
  join(dist, manifest.background.service_worker),
  join(dist, manifest.content_scripts[0].js[0]),
];
if (existsSync(join(dist, 'assets'))) {
  for (const file of readdirSync(join(dist, 'assets'))) {
    if (file.endsWith('.js')) jsFiles.push(join(dist, 'assets', file));
  }
}
const urlPattern = /https?:\/\/[^\s"'`<>)]+/g;
for (const file of jsFiles) {
  if (!existsSync(file)) continue;
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(urlPattern)) {
    const url = match[0];
    check(
      ALLOWED_URL_PATTERNS.some((pattern) => pattern.test(url)),
      `${file} contains an unexpected external URL: ${url}`,
    );
  }
}
for (const dir of assetDirs) {
  if (!existsSync(dir)) continue;
}

check(
  existsSync(join(dist, 'assets', 'icons', 'polymorph.svg')),
  'assets/icons/polymorph.svg source missing',
);

if (problems.length > 0) {
  console.error('dist verification failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('dist verification passed: manifest, worker, content, popup, options, icons 16/32/48/128, no bundled media, URLs allowlisted');