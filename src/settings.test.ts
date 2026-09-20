import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALLOWLIST } from './defaults';
import { defaultSettings, loadSettings, mergeSettings, sanitizeRules } from './settings';

const ENABLED_RULES = [
  { id: 'rage-bait', name: 'Rage bait', instructions: 'Engineered outrage.', enabled: true },
];

interface FakeStorage {
  data: Record<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  triggerDuringGet(fn: () => void): void;
}

/**
 * Models the actual install race: the reader takes an empty snapshot, an
 * external write lands while the read is in flight, and then the code under
 * test continues. A reader cannot clobber the external write; the old
 * install-time writer could (read empty -> external write -> set defaults).
 */
function interleavingStorage(): FakeStorage {
  const data: Record<string, unknown> = {};
  let duringGet: (() => void) | null = null;
  return {
    data,
    get: vi.fn(async (keys: string[]) => {
      const snapshot = Object.fromEntries(keys.map((key) => [key, data[key]]));
      if (duringGet !== null) {
        const run = duringGet;
        duringGet = null;
        run();
      }
      return snapshot;
    }),
    set: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(data, patch);
    }),
    triggerDuringGet: (fn: () => void) => {
      duringGet = fn;
    },
  };
}

function stubLocalStorage(storage: FakeStorage): void {
  vi.stubGlobal('chrome', {
    storage: {
      local: storage,
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    const storage = interleavingStorage();
    stubLocalStorage(storage);
    storage.triggerDuringGet(() => {
      storage.data.rules = ENABLED_RULES;
      storage.data.masterEnabled = true;
      storage.data.allowlist = ['x.com'];
    });

    return loadSettings().then(async (settings) => {
      // The snapshot was empty, so this read returns virtual defaults...
      expect(settings.rules.every((rule) => rule.enabled === false)).toBe(true);
      // ...and crucially no write happens, so the external value survives.
      expect(storage.set).not.toHaveBeenCalled();
      expect(storage.data.rules).toEqual(ENABLED_RULES);
      // The next read observes the external write, not defaults.
      const later = await loadSettings();
      expect(later.rules).toEqual(ENABLED_RULES);
      expect(later.allowlist).toEqual(['x.com']);
    });
  });

  it('US-001 a truly empty store still yields first-run defaults without writing', async () => {
    const storage = interleavingStorage();
    stubLocalStorage(storage);
    const settings = await loadSettings();
    expect(settings.rules).toHaveLength(3);
    expect(settings.rules.every((rule) => rule.enabled === false)).toBe(true);
    expect(settings.allowlist).toEqual(DEFAULT_ALLOWLIST);
    expect(storage.set).not.toHaveBeenCalled();
  });
});