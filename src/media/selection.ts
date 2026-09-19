import { RECENT_PICK_LIMIT } from '../defaults';
import type { MediaAssetMeta } from './types';

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

/** Library order: oldest first, id as the tie-breaker. */
export function orderedIds(assets: readonly MediaAssetMeta[]): string[] {
  return [...assets]
    .sort((a, b) => (a.addedAt === b.addedAt ? a.id.localeCompare(b.id) : a.addedAt - b.addedAt))
    .map((asset) => asset.id);
}

/**
 * US-014: deterministic per-post draw from the ordered user pile, skipping
 * the page's recent picks when an alternative exists. Returns null for an
 * empty pile (the caller collapses instead).
 */
export function pickMediaIndex(
  key: string,
  ids: readonly string[],
  recent: readonly string[],
): number | null {
  if (ids.length === 0) return null;
  const start = stableIndex(key, ids.length);
  const recentSet = new Set(recent);
  let index = start;
  for (let step = 0; step < ids.length; step += 1) {
    const candidate = ids[index];
    if (candidate !== undefined && !recentSet.has(candidate)) return index;
    index = (index + 1) % ids.length;
  }
  return start;
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