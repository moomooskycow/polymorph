import { describe, expect, it } from 'vitest';
import { DecisionCache, hashText } from './cache';

describe('US-006 session cache', () => {
  it('US-006 hashes identical post text to the same key', async () => {
    const a = await hashText('one post, same words');
    const b = await hashText('one post, same words');
    const c = await hashText('one post, different words');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('US-006 reuses a cached decision instead of asking Jev again', () => {
    const cache = new DecisionCache();
    const decision = {
      verdict: 'collapse',
      ruleId: 'rage-bait',
      ruleName: 'Rage bait',
      probability: 0.95,
      confidence: 0.9,
    } as const;
    cache.set('hash-1', decision);
    expect(cache.get('hash-1')).toEqual(decision);
    expect(cache.get('hash-2')).toBeUndefined();
  });

  it('US-006 caches leave decisions too', () => {
    const cache = new DecisionCache();
    cache.set('hash-1', { verdict: 'leave', reason: 'no_rule_matched' });
    expect(cache.get('hash-1')).toEqual({ verdict: 'leave', reason: 'no_rule_matched' });
  });

  it('US-006 survives a worker restart via snapshot and restore', () => {
    const cache = new DecisionCache();
    cache.set('hash-1', { verdict: 'leave', reason: 'jev_error' });
    const restarted = new DecisionCache();
    restarted.restore(cache.snapshot());
    expect(restarted.get('hash-1')).toEqual({ verdict: 'leave', reason: 'jev_error' });
  });

  it('US-006 stays bounded, evicting the oldest entry', () => {
    const cache = new DecisionCache(2);
    cache.set('a', { verdict: 'leave', reason: 'no_key' });
    cache.set('b', { verdict: 'leave', reason: 'no_key' });
    cache.set('c', { verdict: 'leave', reason: 'no_key' });
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
  });
});