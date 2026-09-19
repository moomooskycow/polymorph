import { RECENT_PICK_LIMIT } from '../defaults';
import type { Category, Face, ReplacementMix } from '../types';
import type { ReplacementAsset } from './library';

export const CATEGORY_ORDER: readonly Category[] = ['cute', 'meme', 'motivation'];

/** US-008: a rule either pins a mix or inherits the global one. */
export function resolveMix(face: Face, globalMix: ReplacementMix): ReplacementMix {
  return face === 'inherit' ? globalMix : face;
}

/** US-008: candidate pool for a mix. `collapse` has no art. */
export function candidatesFor(
  mix: ReplacementMix,
  assets: readonly ReplacementAsset[],
): ReplacementAsset[] {
  if (mix === 'collapse') return [];
  if (mix === 'mixed') return [...assets];
  return assets.filter((asset) => asset.category === mix);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable index in [0, length). Same key always lands on the same slot. */
export function stableIndex(key: string, length: number): number {
  if (length <= 0) return 0;
  return fnv1a(key) % length;
}

/**
 * US-009: deterministic replacement for a post. The key is
 * `normalized text + rule id`, so the same post keeps the same replacement
 * across re-renders. A small recency list avoids immediate repeats.
 */
export function pickReplacement(args: {
  key: string;
  mix: ReplacementMix;
  assets: readonly ReplacementAsset[];
  recent?: readonly string[];
  reducedMotion?: boolean;
}): ReplacementAsset | null {
  const pool = candidatesFor(args.mix, args.assets);
  if (pool.length === 0) return null;

  const category =
    args.mix === 'mixed'
      ? (CATEGORY_ORDER[stableIndex(`${args.key}:category`, CATEGORY_ORDER.length)] ?? 'cute')
      : args.mix;
  const inCategory = pool.filter((asset) => asset.category === category);
  const bucket = inCategory.length > 0 ? inCategory : pool;

  const start = stableIndex(args.key, bucket.length);
  const recent = new Set(args.recent ?? []);
  let chosen = bucket[start] as ReplacementAsset;
  for (let step = 1; step < bucket.length; step += 1) {
    if (!recent.has(chosen.id)) break;
    chosen = bucket[(start + step) % bucket.length] as ReplacementAsset;
  }

  return applyReducedMotion(chosen, args.assets, args.reducedMotion === true);
}

/** US-009: animated art falls back to its static sibling under reduced motion. */
export function applyReducedMotion(asset: ReplacementAsset, assets: readonly ReplacementAsset[], reducedMotion: boolean): ReplacementAsset;
export function applyReducedMotion(asset: null, assets: readonly ReplacementAsset[], reducedMotion: boolean): null;
export function applyReducedMotion(
  asset: ReplacementAsset | null,
  assets: readonly ReplacementAsset[],
  reducedMotion: boolean,
): ReplacementAsset | null {
  if (asset === null || !reducedMotion || asset.motion !== 'animated' || !asset.staticFallback) {
    return asset;
  }
  return assets.find((candidate) => candidate.id === asset.staticFallback) ?? asset;
}

/** Bounded recency buffer; newest last. */
export function rememberRecent(
  recent: readonly string[],
  assetId: string,
  limit = RECENT_PICK_LIMIT,
): string[] {
  const next = [...recent, assetId];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** True when a browser media query says the user wants reduced motion. */
export function prefersReducedMotion(matchMedia: (query: string) => MediaQueryList): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}