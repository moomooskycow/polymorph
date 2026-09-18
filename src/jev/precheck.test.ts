import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWLIST, EXAMPLE_RULES } from '../defaults';
import type { Settings } from '../types';
import { normalizeText, precheck } from './precheck';

const enabledRule = { ...EXAMPLE_RULES[1]!, enabled: true };

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    masterEnabled: true,
    rules: [enabledRule],
    allowlist: [...DEFAULT_ALLOWLIST],
    ...overrides,
  };
}

const longText = 'A post that is comfortably longer than forty visible characters.';

describe('US-001 no enabled rule means no Jev call', () => {
  it('US-001 stops before Jev when every rule is disabled', () => {
    expect(
      precheck({ host: 'x.com', settings: settings({ rules: [...EXAMPLE_RULES] }), keyPresent: true, text: longText }),
    ).toEqual({ verdict: 'leave', reason: 'no_rules_enabled' });
    expect(
      precheck({ host: 'x.com', settings: settings({ rules: [] }), keyPresent: true, text: longText }),
    ).toEqual({ verdict: 'leave', reason: 'no_rules_enabled' });
  });

  it('US-001 proceeds when at least one rule is enabled, a key exists, and the host is allowed', () => {
    expect(
      precheck({ host: 'x.com', settings: settings(), keyPresent: true, text: longText }),
    ).toBeNull();
  });
});

describe('US-004/US-005 precheck ordering', () => {
  it('US-004 denylist wins over allowlist, master, and an enabled rule', () => {
    expect(
      precheck({
        host: 'chase.com',
        settings: settings({ allowlist: [...DEFAULT_ALLOWLIST, 'chase.com'] }),
        keyPresent: true,
        text: longText,
      }),
    ).toEqual({ verdict: 'leave', reason: 'denylisted' });
  });

  it('US-005 master off stops everything; unknown hosts are not allowlisted', () => {
    expect(
      precheck({ host: 'x.com', settings: settings({ masterEnabled: false }), keyPresent: true, text: longText }),
    ).toEqual({ verdict: 'leave', reason: 'master_disabled' });
    expect(
      precheck({ host: 'example.com', settings: settings(), keyPresent: true, text: longText }),
    ).toEqual({ verdict: 'leave', reason: 'not_allowlisted' });
  });

  it('US-001 a missing key and a short post stop before Jev', () => {
    expect(
      precheck({ host: 'x.com', settings: settings(), keyPresent: false, text: longText }),
    ).toEqual({ verdict: 'leave', reason: 'no_key' });
    expect(
      precheck({ host: 'x.com', settings: settings(), keyPresent: true, text: 'too short' }),
    ).toEqual({ verdict: 'leave', reason: 'skipped_short' });
  });

  it('US-002 text is whitespace-collapsed before the length check', () => {
    expect(normalizeText('  a\n\n b  ')).toBe('a b');
    expect(precheck({ host: 'x.com', settings: settings(), keyPresent: true, text: '   ' })).toEqual({
      verdict: 'leave',
      reason: 'skipped_short',
    });
  });
});