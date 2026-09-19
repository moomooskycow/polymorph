import type { Face } from './types';
import kitten1 from '../assets/faces/kitten-1.svg?raw';
import kitten2 from '../assets/faces/kitten-2.svg?raw';
import meme1 from '../assets/faces/meme-1.svg?raw';
import meme2 from '../assets/faces/meme-2.svg?raw';

export type FaceKind = Exclude<Face, 'collapse'>;

/**
 * US-003: bundled SVG files, copied into `dist/assets/faces/` by the build.
 * The content script renders the raw SVG inline, so there is no network fetch
 * and no live CDN at any point.
 */
export const FACE_ASSETS: Record<FaceKind, readonly string[]> = {
  kitten: ['kitten-1.svg', 'kitten-2.svg'],
  meme: ['meme-1.svg', 'meme-2.svg'],
};

export const FACE_SVGS: Record<FaceKind, readonly string[]> = {
  kitten: [kitten1, kitten2],
  meme: [meme1, meme2],
};

export function faceAssetFiles(face: Face): readonly string[] {
  return face === 'collapse' ? [] : FACE_ASSETS[face];
}

/** Deterministic FNV-1a pick, so the same rule always gets the same face. */
export function pickFaceIndex(face: FaceKind, key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % FACE_SVGS[face].length;
}

export function pickFaceSvg(face: Face, key: string): string | null {
  if (face === 'collapse') return null;
  return FACE_SVGS[face][pickFaceIndex(face, key)] ?? null;
}