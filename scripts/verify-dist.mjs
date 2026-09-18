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
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
];
for (const file of required) {
  check(typeof file === 'string' && existsSync(join(dist, file)), `missing manifest file ${file}`);
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

const faceDir = join(dist, 'assets', 'faces');
const faces = existsSync(faceDir) ? readdirSync(faceDir) : [];
check(faces.length > 0, 'assets/faces/ has no bundled faces');
for (const file of faces) {
  check(file.endsWith('.svg'), `${file} is not an SVG`);
  check(readFileSync(join(faceDir, file), 'utf8').startsWith('<svg'), `${file} is not SVG markup`);
}
for (const resource of (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources ?? [])) {
  if (!resource.includes('*')) continue;
  const prefix = resource.slice(0, resource.indexOf('*'));
  check(
    faces.length > 0 && existsSync(join(dist, prefix.replace(/\/$/, ''))),
    `web_accessible_resources ${resource} matches nothing`,
  );
}

if (problems.length > 0) {
  console.error('dist verification failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `dist verification passed: manifest, worker, content, popup, options, ${faces.length} bundled faces`,
);