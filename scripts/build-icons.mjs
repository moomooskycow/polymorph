#!/usr/bin/env node
/**
 * Renders the Polymorph mark (assets/icons/polymorph.svg) to the four PNG
 * sizes the manifest needs. Runs before Vite so `public/` carries the icons
 * into `dist/icons/`. Fails closed: a missing renderer or a wrong-sized PNG
 * stops the build instead of shipping a broken icon.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'assets/icons/polymorph.svg');
const outDir = resolve(root, 'public/icons');
const sizes = [16, 32, 48, 128];

mkdirSync(outDir, { recursive: true });

for (const size of sizes) {
  const out = resolve(outDir, `icon-${size}.png`);
  try {
    execFileSync(
      'rsvg-convert',
      ['--width', String(size), '--height', String(size), '--output', out, source],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (error) {
    console.error(
      `icon build failed at ${size}px: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error('Install librsvg (rsvg-convert) on PATH, then rerun `pnpm build`.');
    process.exit(1);
  }
  verifyPng(out, size);
}

console.log(`icons: wrote ${sizes.length} PNGs (${sizes.join('/')}) to public/icons/`);

function verifyPng(file, expected) {
  const data = readFileSync(file);
  const pngSignature = data.subarray(0, 8).toString('hex');
  if (pngSignature !== '89504e470d0a1a0a') {
    console.error(`icon build failed: ${file} is not a PNG`);
    process.exit(1);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expected || height !== expected) {
    console.error(
      `icon build failed: ${file} is ${width}x${height}, expected ${expected}x${expected}`,
    );
    process.exit(1);
  }
}