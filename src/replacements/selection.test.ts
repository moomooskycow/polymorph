import { describe, expect, it } from 'vitest';
import type { ReplacementAsset } from './library';
import {
  applyReducedMotion,
  candidatesFor,
  pickReplacement,
  prefersReducedMotion,
  rememberRecent,
  resolveMix,
  stableIndex,
} from './selection';

function asset(id: string, category: ReplacementAsset['category'], motion: ReplacementAsset['motion'] = 'static', staticFallback?: string): ReplacementAsset {
  return {
    id,
    file: `${id}.svg`,
    category,
    caption: `Caption for ${id}`,
    motion,
    ...(staticFallback === undefined ? {} : { staticFallback }),
    license: 'CC0-1.0 (authored for Polymorph)',
    author: 'test',
    created: '2026-09-19',
    svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
}

const assets: ReplacementAsset[] = [
  asset('cute-1', 'cute'),
  asset('cute-2', 'cute'),
  asset('cute-3', 'cute'),
  asset('meme-1', 'meme'),
  asset('meme-2', 'meme'),
  asset('meme-3', 'meme'),
  asset('mot-1', 'motivation'),
  asset('mot-2', 'motivation'),
  asset('mot-3', 'motivation'),
  asset('cute-animated', 'cute', 'animated', 'cute-1'),
];

describe('US-008 mix resolution', () => {
  it('US-008 inherit uses the global mix; an override wins', () => {
    expect(resolveMix('inherit', 'mixed')).toBe('mixed');
    expect(resolveMix('inherit', 'cute')).toBe('cute');
    expect(resolveMix('meme', 'cute')).toBe('meme');
    expect(resolveMix('collapse', 'mixed')).toBe('collapse');
  });

  it('US-008 candidates follow the mix, and collapse has none', () => {
    expect(candidatesFor('collapse', assets)).toEqual([]);
    expect(candidatesFor('mixed', assets)).toHaveLength(assets.length);
    expect(candidatesFor('meme', assets).every((item) => item.category === 'meme')).toBe(true);
    expect(candidatesFor('motivation', assets)).toHaveLength(3);
  });
});

describe('US-009 stable selection', () => {
  it('US-009 the same post key always picks the same asset', () => {
    const args = { key: 'post text\u0000rage-bait', mix: 'mixed' as const, assets };
    const first = pickReplacement(args);
    for (let index = 0; index < 20; index += 1) {
      expect(pickReplacement(args)?.id).toBe(first?.id);
    }
    expect(first).not.toBeNull();
  });

  it('US-009 different text or rules can pick different assets', () => {
    const keys = ['one\u0000rule', 'two\u0000rule', 'three\u0000rule', 'four\u0000rule'];
    const picks = new Set(keys.map((key) => pickReplacement({ key, mix: 'mixed', assets })?.id));
    expect(picks.size).toBeGreaterThan(1);
  });

  it('US-009 mixed spreads across all three categories', () => {
    const categories = new Set(
      Array.from({ length: 40 }, (_, index) =>
        pickReplacement({ key: `post-${index}\u0000rule`, mix: 'mixed', assets })?.category,
      ),
    );
    expect(categories).toEqual(new Set(['cute', 'meme', 'motivation']));
  });

  it('US-009 a recent pick is avoided when an alternative exists', () => {
    const key = 'the same post\u0000rage-bait';
    const first = pickReplacement({ key, mix: 'cute', assets });
    expect(first).not.toBeNull();
    const second = pickReplacement({ key, mix: 'cute', assets, recent: [first!.id] });
    expect(second?.category).toBe('cute');
    expect(second!.id).not.toBe(first!.id);
  });

  it('US-009 an all-recent pool still returns an asset (no infinite walk)', () => {
    const recent = assets.filter((item) => item.category === 'meme').map((item) => item.id);
    const pick = pickReplacement({ key: 'post\u0000rule', mix: 'meme', assets, recent });
    expect(pick).not.toBeNull();
    expect(pick?.category).toBe('meme');
  });

  it('US-009 collapse mix returns no replacement at all', () => {
    expect(pickReplacement({ key: 'post\u0000rule', mix: 'collapse', assets })).toBeNull();
  });

  it('US-009 stableIndex is deterministic and bounded', () => {
    expect(stableIndex('key', 7)).toBe(stableIndex('key', 7));
    expect(stableIndex('key', 7)).toBeLessThan(7);
    expect(stableIndex('key', 0)).toBe(0);
  });
});

describe('US-009 reduced motion', () => {
  const animated = asset('cute-animated', 'cute', 'animated', 'cute-1');

  it('US-009 animated art falls back to its static sibling', () => {
    const picked = applyReducedMotion(animated, assets, true);
    expect(picked.id).toBe('cute-1');
    expect(picked.motion).toBe('static');
  });

  it('US-009 without the preference animation is untouched', () => {
    expect(applyReducedMotion(animated, assets, false).id).toBe('cute-animated');
  });

  it('US-009 a missing fallback degrades to the animated asset, never to null', () => {
    const orphan = asset('orphan', 'meme', 'animated', 'does-not-exist');
    expect(applyReducedMotion(orphan, assets, true).id).toBe('orphan');
  });

  it('US-009 the media query branch is read through a matchMedia seam', () => {
    const reduce = (query: string): MediaQueryList => ({ matches: query.includes('reduce') }) as MediaQueryList;
    const noPreference = (): MediaQueryList => ({ matches: false }) as MediaQueryList;
    expect(prefersReducedMotion(reduce)).toBe(true);
    expect(prefersReducedMotion(noPreference)).toBe(false);
  });
});

describe('US-009 recency buffer', () => {
  it('US-009 keeps the newest picks within the limit', () => {
    let recent: string[] = [];
    for (let index = 0; index < 12; index += 1) recent = rememberRecent(recent, `asset-${index}`, 8);
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('asset-4');
    expect(recent[7]).toBe('asset-11');
  });
});