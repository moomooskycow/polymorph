import manifest from '../../assets/replacements/manifest.json';
import cuteKitten1 from '../../assets/replacements/cute-kitten-1.svg?raw';
import cuteKitten2 from '../../assets/replacements/cute-kitten-2.svg?raw';
import cutePup1 from '../../assets/replacements/cute-pup-1.svg?raw';
import cuteOtter1 from '../../assets/replacements/cute-otter-1.svg?raw';
import cuteDuck1 from '../../assets/replacements/cute-duck-1.svg?raw';
import cuteDuck2 from '../../assets/replacements/cute-duck-2.svg?raw';
import memeShock from '../../assets/replacements/meme-shock.svg?raw';
import memeSideEye from '../../assets/replacements/meme-side-eye.svg?raw';
import memeShrug from '../../assets/replacements/meme-shrug.svg?raw';
import memePanic from '../../assets/replacements/meme-panic.svg?raw';
import motivateSmallSteps from '../../assets/replacements/motivate-small-steps.svg?raw';
import motivateCloseTab from '../../assets/replacements/motivate-close-tab.svg?raw';
import motivateRest from '../../assets/replacements/motivate-rest.svg?raw';
import motivateStartUgly from '../../assets/replacements/motivate-start-ugly.svg?raw';
import type { Category } from '../types';

export type Motion = 'static' | 'animated';

export interface ReplacementAsset {
  id: string;
  file: string;
  category: Category;
  caption: string;
  motion: Motion;
  staticFallback?: string;
  license: string;
  author: string;
  created: string;
  /** Raw SVG text, inlined into the card's shadow root. */
  svg: string;
}

export interface ReplacementManifestItem {
  id: string;
  file: string;
  category: Category;
  caption: string;
  motion: Motion;
  staticFallback?: string;
  license: string;
  author: string;
  created: string;
}

export const REPLACEMENT_LICENSE = 'CC0-1.0 (authored for Polymorph)';

const SVG_BY_FILE: Record<string, string> = {
  'cute-kitten-1.svg': cuteKitten1,
  'cute-kitten-2.svg': cuteKitten2,
  'cute-pup-1.svg': cutePup1,
  'cute-otter-1.svg': cuteOtter1,
  'cute-duck-1.svg': cuteDuck1,
  'cute-duck-2.svg': cuteDuck2,
  'meme-shock.svg': memeShock,
  'meme-side-eye.svg': memeSideEye,
  'meme-shrug.svg': memeShrug,
  'meme-panic.svg': memePanic,
  'motivate-small-steps.svg': motivateSmallSteps,
  'motivate-close-tab.svg': motivateCloseTab,
  'motivate-rest.svg': motivateRest,
  'motivate-start-ugly.svg': motivateStartUgly,
};

export const REPLACEMENT_MANIFEST = manifest as {
  schema: number;
  items: ReplacementManifestItem[];
};

/** US-002/US-003: the whole library, with SVG text already in the bundle. */
export const REPLACEMENTS: readonly ReplacementAsset[] = REPLACEMENT_MANIFEST.items.map((item) => ({
  ...item,
  svg: SVG_BY_FILE[item.file] ?? '',
}));

export function assetById(id: string): ReplacementAsset | undefined {
  return REPLACEMENTS.find((asset) => asset.id === id);
}

export function assetsByCategory(category: Category): ReplacementAsset[] {
  return REPLACEMENTS.filter((asset) => asset.category === category);
}