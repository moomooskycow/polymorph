import { describe, expect, it } from 'vitest';
import { orderedIds, pickMediaIndex, rememberRecent, stableIndex } from './selection';
import type { MediaAssetMeta } from './types';

function meta(id: string, addedAt: number): MediaAssetMeta {
  return {
    id,
    kind: 'png',
    mime: 'image/png',
    size: 10,
    addedAt,
    width: 4,
    height: 4,
    thumb: null,
  };
}

const assets = [meta('b', 2), meta('a', 1), meta('c', 3)];

describe('US-014 stable media selection', () => {
  it('US-014 orders the pile oldest first with id as tie-breaker', () => {
    expect(orderedIds(assets)).toEqual(['a', 'b', 'c']);
    expect(orderedIds([meta('z', 5), meta('y', 5)])).toEqual(['y', 'z']);
  });

  it('US-014 an empty pile picks nothing', () => {
    expect(pickMediaIndex('key', [], [])).toBeNull();
  });

  it('US-014 the same key always draws the same asset', () => {
    const ids = orderedIds(assets);
    const first = pickMediaIndex('post text\u0000rule', ids, []);
    for (let index = 0; index < 20; index += 1) {
      expect(pickMediaIndex('post text\u0000rule', ids, [])).toBe(first);
    }
    expect(first).not.toBeNull();
  });

  it('US-014 recent picks are skipped when an alternative exists', () => {
    const ids = orderedIds(assets);
    const first = pickMediaIndex('post\u0000rule', ids, []) as number;
    const second = pickMediaIndex('post\u0000rule', ids, [ids[first] as string]);
    expect(second).not.toBe(first);
    expect(second).not.toBeNull();
  });

  it('US-014 an all-recent pile still returns an index', () => {
    const ids = orderedIds(assets);
    const pick = pickMediaIndex('post\u0000rule', ids, ids);
    expect(pick).not.toBeNull();
  });

  it('US-014 removal changes the ordered pile and therefore picks', () => {
    const before = orderedIds(assets);
    const after = orderedIds(assets.filter((asset) => asset.id !== 'b'));
    expect(after).toEqual(['a', 'c']);
    expect(before).not.toEqual(after);
    expect(stableIndex('k', after.length)).toBeLessThan(after.length);
  });

  it('US-014 the recency buffer is bounded and newest-last', () => {
    let recent: string[] = [];
    for (let index = 0; index < 12; index += 1) recent = rememberRecent(recent, `id-${index}`, 8);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('id-4');
    expect(recent[7]).toBe('id-11');
  });
});