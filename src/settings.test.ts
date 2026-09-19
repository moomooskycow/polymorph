import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWLIST, DEFAULT_REPLACEMENT_MIX } from './defaults';
import { defaultSettings, mergeSettings, normalizeFace, sanitizeRules } from './settings';

describe('US-001 settings defaults and sanitizing', () => {
  it('US-001 missing storage yields the three disabled examples and the small allowlist', () => {
    const settings = mergeSettings({});
    expect(settings.masterEnabled).toBe(true);
    expect(settings.rules).toHaveLength(3);
    expect(settings.rules.every((rule) => rule.enabled === false)).toBe(true);
    expect(settings.rules.every((rule) => rule.face === 'inherit')).toBe(true);
    expect(settings.allowlist).toEqual(DEFAULT_ALLOWLIST);
    expect(settings.replacementMix).toBe(DEFAULT_REPLACEMENT_MIX);
    expect(defaultSettings().rules[0]).not.toBe(settings.rules[0]);
  });

  it('US-007 v1 stored rules keep working: kitten becomes cute, meme and collapse stay', () => {
    expect(normalizeFace('kitten')).toBe('cute');
    expect(normalizeFace('meme')).toBe('meme');
    expect(normalizeFace('collapse')).toBe('collapse');
    expect(normalizeFace('motivation')).toBe('motivation');
    expect(normalizeFace('inherit')).toBe('inherit');
    expect(normalizeFace(undefined)).toBe('inherit');
    expect(normalizeFace('wat')).toBe('inherit');
  });

  it('US-007 migration never enables a rule and keeps its content', () => {
    const settings = mergeSettings({
      rules: [
        {
          id: 'legacy-kitten',
          name: 'Old kitten rule',
          instructions: 'Hide cute posts.',
          enabled: false,
          face: 'kitten',
        },
        {
          id: 'legacy-on',
          name: 'On rule',
          instructions: 'Hide rage bait.',
          enabled: true,
          face: 'meme',
        },
      ],
    });
    expect(settings.rules).toEqual([
      {
        id: 'legacy-kitten',
        name: 'Old kitten rule',
        instructions: 'Hide cute posts.',
        enabled: false,
        face: 'cute',
      },
      {
        id: 'legacy-on',
        name: 'On rule',
        instructions: 'Hide rage bait.',
        enabled: true,
        face: 'meme',
      },
    ]);
  });

  it('US-008 the replacement mix persists and invalid values fall back to mixed', () => {
    expect(mergeSettings({ replacementMix: 'motivation' }).replacementMix).toBe('motivation');
    expect(mergeSettings({ replacementMix: 'collapse' }).replacementMix).toBe('collapse');
    expect(mergeSettings({ replacementMix: 'kitten' }).replacementMix).toBe('mixed');
    expect(mergeSettings({ replacementMix: 42 }).replacementMix).toBe('mixed');
  });

  it('US-001 drops malformed rules and duplicate ids; unknown faces become inherit', () => {
    const rules = sanitizeRules([
      { id: 'ok', name: 'Ok', instructions: 'Fine.', enabled: true, face: 'meme' },
      { id: 'ok', name: 'Dup', instructions: 'Fine.', enabled: false, face: 'collapse' },
      { id: 'Bad Id', name: 'Nope', instructions: 'Bad id.', enabled: true, face: 'collapse' },
      { id: 'no-name', name: '', instructions: 'No name.', enabled: true, face: 'collapse' },
      { id: 'no-instructions', name: 'No instructions', instructions: '', enabled: true },
      { id: 'face-fallback', name: 'Face', instructions: 'Unknown face.', enabled: true, face: 'wat' },
      { id: 'legacy', name: 'Legacy', instructions: 'Kitten face.', enabled: true, face: 'kitten' },
      null,
      'nope',
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['ok', 'face-fallback', 'legacy']);
    expect(rules[1]?.face).toBe('inherit');
    expect(rules[2]?.face).toBe('cute');
  });

  it('US-001 an empty rules array is respected and allowlist hosts normalize', () => {
    expect(mergeSettings({ rules: [] }).rules).toEqual([]);
    const settings = mergeSettings({
      allowlist: ['Example.com', 'example.com', '  x.com:443 '],
    });
    expect(settings.allowlist).toEqual(['example.com', 'x.com']);
  });
});