#!/usr/bin/env node
/**
 * Verifies that `pnpm build` produced a loadable unpacked MV3 extension.
 * Checks file presence and wiring the way Chrome resolves it, not the build
 * tool's self-report.
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

const replacementsDir = join(dist, 'assets', 'replacements');
const svgFiles = existsSync(replacementsDir)
  ? readdirSync(replacementsDir).filter((file) => file.endsWith('.svg'))
  : [];
check(svgFiles.length >= 12, `assets/replacements/ has ${svgFiles.length} SVGs, expected at least 12`);
for (const file of svgFiles) {
  check(readFileSync(join(replacementsDir, file), 'utf8').startsWith('<svg'), `${file} is not SVG markup`);
}

const libraryManifestPath = join(replacementsDir, 'manifest.json');
check(existsSync(libraryManifestPath), 'assets/replacements/manifest.json missing');
if (existsSync(libraryManifestPath)) {
  const library = JSON.parse(readFileSync(libraryManifestPath, 'utf8'));
  check(Array.isArray(library.items) && library.items.length >= 12, 'library manifest has too few items');
  for (const item of library.items ?? []) {
    check(
      typeof item.file === 'string' && existsSync(join(replacementsDir, item.file)),
      `library item ${item.id} missing ${item.file}`,
    );
    check(typeof item.license === 'string' && item.license.length > 0, `library item ${item.id} has no license`);
  }
}
check(
  existsSync(join(replacementsDir, 'README.md')),
  'assets/replacements/README.md (regeneration instructions) missing',
);
check(
  existsSync(join(dist, 'assets', 'icons', 'polymorph.svg')),
  'assets/icons/polymorph.svg source missing',
);

for (const resource of (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? [])) {
  if (!resource.includes('*')) continue;
  const prefix = resource.slice(0, resource.indexOf('*')).replace(/\/$/, '');
  check(existsSync(join(dist, prefix)), `web_accessible_resources ${resource} matches nothing`);
  if (prefix.endsWith('replacements')) {
    check(svgFiles.length > 0, `web_accessible_resources ${resource} matches no SVGs`);
  }
}

if (problems.length > 0) {
  console.error('dist verification failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `dist verification passed: manifest, worker, content, popup, options, ${svgFiles.length} replacements, icons 16/32/48/128`,
);