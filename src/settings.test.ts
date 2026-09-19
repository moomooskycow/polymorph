import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWLIST } from './defaults';
import { defaultSettings, mergeSettings, missingDefaults, sanitizeRules } from './settings';

describe('US-001 settings defaults and sanitizing', () => {
  it('US-001 missing storage yields the three disabled examples and the small allowlist', () => {
    const settings = mergeSettings({});
    expect(settings.masterEnabled).toBe(true);
    expect(settings.rules).toHaveLength(3);
    expect(settings.rules.every((rule) => rule.enabled === false)).toBe(true);
    expect(settings.rules.every((rule) => !('face' in rule))).toBe(true);
    expect(settings.allowlist).toEqual(DEFAULT_ALLOWLIST);
    expect(defaultSettings().rules[0]).not.toBe(settings.rules[0]);
  });

  it('US-014 legacy rule shapes load without error: face, kitten, and mix are dropped', () => {
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
      replacementMix: 'cute',
    });
    expect(settings.rules).toEqual([
      { id: 'legacy-kitten', name: 'Old kitten rule', instructions: 'Hide cute posts.', enabled: false },
      { id: 'legacy-on', name: 'On rule', instructions: 'Hide rage bait.', enabled: true },
    ]);
    expect(settings.rules.every((rule) => !('face' in rule))).toBe(true);
    expect(!('replacementMix' in settings)).toBe(true);
  });

  it('US-014 migration never enables a rule that storage had disabled', () => {
    const settings = mergeSettings({
      rules: [
        { id: 'a', name: 'A', instructions: 'Do a thing.', enabled: false, face: 'collapse' },
        { id: 'b', name: 'B', instructions: 'Do b thing.', enabled: true, replacementMix: 'mixed' },
      ],
    });
    expect(settings.rules.map((rule) => rule.enabled)).toEqual([false, true]);
  });

  it('US-001 drops malformed rules and duplicate ids', () => {
    const rules = sanitizeRules([
      { id: 'ok', name: 'Ok', instructions: 'Fine.', enabled: true, face: 'meme' },
      { id: 'ok', name: 'Dup', instructions: 'Fine.', enabled: false },
      { id: 'Bad Id', name: 'Nope', instructions: 'Bad id.', enabled: true },
      { id: 'no-name', name: '', instructions: 'No name.', enabled: true },
      { id: 'no-instructions', name: 'No instructions', instructions: '', enabled: true },
      { id: 'legacy', name: 'Legacy', instructions: 'Kitten face.', enabled: true, face: 'kitten' },
      null,
      'nope',
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['ok', 'legacy']);
    expect(rules[1]).toEqual({
      id: 'legacy',
      name: 'Legacy',
      instructions: 'Kitten face.',
      enabled: true,
    });
  });

  it('US-001 an empty rules array is respected and allowlist hosts normalize', () => {
    expect(mergeSettings({ rules: [] }).rules).toEqual([]);
    const settings = mergeSettings({
      allowlist: ['Example.com', 'example.com', '  x.com:443 '],
    });
    expect(settings.allowlist).toEqual(['example.com', 'x.com']);
  });

  it('US-001 install defaults never clobber settings written during onInstalled', () => {
    const configured = {
      masterEnabled: true,
      rules: [{ id: 'mine', name: 'Mine', instructions: 'Do it.', enabled: true }],
      allowlist: ['x.com'],
    };
    expect(missingDefaults(configured)).toEqual({});
    const merged = mergeSettings({ ...configured, ...missingDefaults(configured) });
    expect(merged.rules).toEqual(configured.rules);
    expect(merged.allowlist).toEqual(['x.com']);

    const partial = missingDefaults({ rules: configured.rules });
    expect(partial.rules).toBeUndefined();
    expect(partial.allowlist).toEqual(DEFAULT_ALLOWLIST);
    expect(partial.masterEnabled).toBe(true);
  });
});