import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPLACEMENTS, REPLACEMENT_MANIFEST, REPLACEMENT_LICENSE, assetById } from './library';

const dir = `${resolve(process.cwd(), 'assets', 'replacements')}/`;
const readText = (file: string) => readFileSync(`${dir}${file}`, 'utf8');

describe('US-008 replacement library completeness', () => {
  it('US-008 bundles 12-16 original items with at least four per category', () => {
    expect(REPLACEMENT_MANIFEST.items.length).toBeGreaterThanOrEqual(12);
    expect(REPLACEMENT_MANIFEST.items.length).toBeLessThanOrEqual(16);
    for (const category of ['cute', 'meme', 'motivation'] as const) {
      const count = REPLACEMENT_MANIFEST.items.filter((item) => item.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(4);
    }
  });

  it('US-008 ids, files, and captions are unique and complete', () => {
    const ids = new Set<string>();
    const files = new Set<string>();
    const captions = new Set<string>();
    for (const item of REPLACEMENT_MANIFEST.items) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.caption.length, item.id).toBeGreaterThan(8);
      expect(ids.has(item.id), item.id).toBe(false);
      expect(files.has(item.file), item.file).toBe(false);
      expect(captions.has(item.caption), item.caption).toBe(false);
      ids.add(item.id);
      files.add(item.file);
      captions.add(item.caption);
    }
  });

  it('US-008 every item carries source/license metadata, and every file has an item', () => {
    for (const item of REPLACEMENT_MANIFEST.items) {
      expect(item.license, item.id).toBe(REPLACEMENT_LICENSE);
      expect(item.author, item.id).toBeTruthy();
      expect(item.created, item.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(existsSync(`${dir}${item.file}`), item.file).toBe(true);
      expect(statSync(`${dir}${item.file}`).size, item.file).toBeGreaterThan(100);
    }
    const svgFiles = readdirSync(dir).filter((file) => file.endsWith('.svg'));
    expect(svgFiles.sort()).toEqual(REPLACEMENT_MANIFEST.items.map((item) => item.file).sort());
  });

  it('US-008 animated items name a static fallback that exists', () => {
    const animated = REPLACEMENT_MANIFEST.items.filter((item) => item.motion === 'animated');
    expect(animated.length).toBeGreaterThanOrEqual(2);
    for (const item of animated) {
      expect(item.staticFallback, item.id).toBeTruthy();
      const fallback = assetById(item.staticFallback ?? '');
      expect(fallback, `${item.id} fallback`).toBeDefined();
      expect(fallback?.motion).toBe('static');
    }
  });

  it('US-003 the rendered SVG text is the exact bundled file, never a remote URL', () => {
    for (const item of REPLACEMENT_MANIFEST.items) {
      const raw = readText(item.file);
      const bundled = REPLACEMENTS.find((asset) => asset.id === item.id);
      expect(bundled?.svg, item.id).toBe(raw);
      expect(raw, item.id).not.toContain('<image');
      expect(raw, item.id).not.toContain('href=');
      expect(raw, item.id).not.toContain('url(');
      // The only http is the SVG XML namespace, not a live resource.
      expect(raw.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''), item.id).not.toContain(
        'http',
      );
    }
  });

  it('US-008 the regeneration README exists and names the workflow', () => {
    const readme = readText('README.md');
    expect(readme).toContain('manifest.json');
    expect(readme).toMatch(/reduced[- ]motion/i);
    expect(readme).toMatch(/original/i);
  });
});