import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWLIST } from './defaults';
import { defaultSettings, mergeSettings, sanitizeRules } from './settings';

describe('US-001 settings defaults and sanitizing', () => {
  it('US-001 missing storage yields the three disabled examples and the small allowlist', () => {
    const settings = mergeSettings({});
    expect(settings.masterEnabled).toBe(true);
    expect(settings.rules).toHaveLength(3);
    expect(settings.rules.every((rule) => rule.enabled === false)).toBe(true);
    expect(settings.allowlist).toEqual(DEFAULT_ALLOWLIST);
    expect(defaultSettings().rules[0]).not.toBe(settings.rules[0]);
  });

  it('US-001 keeps a valid saved rule and its enabled flag', () => {
    const settings = mergeSettings({
      masterEnabled: false,
      rules: [
        {
          id: 'my-rule',
          name: 'My rule',
          instructions: 'Hide posts about llamas.',
          enabled: true,
          face: 'kitten',
        },
      ],
      allowlist: ['Example.com', 'example.com', '  x.com:443 '],
    });
    expect(settings.masterEnabled).toBe(false);
    expect(settings.rules).toEqual([
      {
        id: 'my-rule',
        name: 'My rule',
        instructions: 'Hide posts about llamas.',
        enabled: true,
        face: 'kitten',
      },
    ]);
    expect(settings.allowlist).toEqual(['example.com', 'x.com']);
  });

  it('US-001 drops malformed rules, duplicate ids, and unknown faces fall back', () => {
    const rules = sanitizeRules([
      { id: 'ok', name: 'Ok', instructions: 'Fine.', enabled: true, face: 'meme' },
      { id: 'ok', name: 'Dup', instructions: 'Fine.', enabled: false, face: 'collapse' },
      { id: 'Bad Id', name: 'Nope', instructions: 'Bad id.', enabled: true, face: 'collapse' },
      { id: 'no-name', name: '', instructions: 'No name.', enabled: true, face: 'collapse' },
      { id: 'no-instructions', name: 'No instructions', instructions: '', enabled: true },
      { id: 'face-fallback', name: 'Face', instructions: 'Unknown face.', enabled: true, face: 'wat' },
      null,
      'nope',
    ]);
    expect(rules.map((rule) => rule.id)).toEqual(['ok', 'face-fallback']);
    expect(rules[1]?.face).toBe('collapse');
  });

  it('US-001 an empty rules array is respected (user deleted every rule)', () => {
    expect(mergeSettings({ rules: [] }).rules).toEqual([]);
  });
});