import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACE_ASSETS, FACE_SVGS, faceAssetFiles, pickFaceIndex, pickFaceSvg } from './faces';

const facesDir = `${resolve(process.cwd(), 'assets', 'faces')}/`;
const readFace = (file: string) => readFileSync(`${facesDir}${file}`, 'utf8');

describe('US-003 bundled faces', () => {
  it('US-003 ships only bundled SVG kittens and meme cards', () => {
    const files = readdirSync(facesDir).sort();
    expect(files).toEqual(['kitten-1.svg', 'kitten-2.svg', 'meme-1.svg', 'meme-2.svg']);
    for (const file of files) {
      const svg = readFace(file);
      expect(svg.startsWith('<svg'), file).toBe(true);
      expect(svg, file).not.toContain('<image');
      expect(svg, file).not.toContain('href=');
      expect(svg, file).not.toContain('url(');
      // The only http is the SVG XML namespace, not a live resource.
      expect(svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''), file).not.toContain(
        'http',
      );
    }
  });

  it('US-003 the rendered SVG text is the exact bundled file, not a URL', () => {
    for (const face of ['kitten', 'meme'] as const) {
      FACE_ASSETS[face].forEach((file, index) => {
        expect(FACE_SVGS[face][index]).toBe(readFace(file));
      });
    }
  });

  it('US-003 a collapse face names files, a kitten or meme face owns some', () => {
    expect(faceAssetFiles('collapse')).toEqual([]);
    expect(faceAssetFiles('kitten')).toEqual(['kitten-1.svg', 'kitten-2.svg']);
    expect(faceAssetFiles('meme')).toEqual(['meme-1.svg', 'meme-2.svg']);
  });

  it('US-003 face choice is deterministic and stays inside the bundled set', () => {
    const first = pickFaceSvg('kitten', 'rage-bait');
    expect(first).toBe(pickFaceSvg('kitten', 'rage-bait'));
    expect(FACE_SVGS.kitten).toContain(first);
    expect(pickFaceSvg('collapse', 'rage-bait')).toBeNull();
    for (let index = 0; index < 50; index += 1) {
      const pick = pickFaceIndex('meme', `rule-${index}`);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(FACE_SVGS.meme.length);
    }
  });
});