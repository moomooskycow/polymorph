import { describe, expect, it } from 'vitest';
import { DEFAULT_ALLOWLIST, EXAMPLE_RULES } from './defaults';
import {
  HARD_DENYLIST,
  canRunOnHost,
  hostFromUrl,
  isAllowlisted,
  isDenylisted,
  normalizeHost,
  toggleHost,
} from './hosts';

describe('US-004 hard denylist', () => {
  it('US-004 denies mail hosts and their subdomains', () => {
    for (const host of [
      'gmail.com',
      'mail.google.com',
      'outlook.com',
      'outlook.live.com',
      'outlook.office.com',
      'outlook.office365.com',
      'hotmail.com',
      'fastmail.com',
      'app.fastmail.com',
      'fastmail.fm',
      'proton.me',
      'protonmail.com',
      'mail.proton.me',
    ]) {
      expect(isDenylisted(host), host).toBe(true);
    }
  });

  it('US-004 denies common US banks and brokers, including subdomains', () => {
    for (const host of [
      'chase.com',
      'secure.chase.com',
      'bankofamerica.com',
      'bofa.com',
      'wellsfargo.com',
      'usbank.com',
      'capitalone.com',
      'fidelity.com',
      'vanguard.com',
      'schwab.com',
      'paypal.com',
      'venmo.com',
    ]) {
      expect(isDenylisted(host), host).toBe(true);
    }
  });

  it('US-004 denies password managers and local surfaces', () => {
    for (const host of [
      '1password.com',
      'my.1password.com',
      'bitwarden.com',
      'lastpass.com',
      'dashlane.com',
      'localhost',
      'app.localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
    ]) {
      expect(isDenylisted(host), host).toBe(true);
    }
  });

  it('US-004 does not deny unrelated hosts', () => {
    for (const host of ['x.com', 'reddit.com', 'news.ycombinator.com', 'example.com']) {
      expect(isDenylisted(host), host).toBe(false);
    }
  });

  it('US-004 denylist beats an allowlist entry and the popup cannot unlock it', () => {
    const settings = { masterEnabled: true, allowlist: [...DEFAULT_ALLOWLIST, 'chase.com'] };
    expect(canRunOnHost('chase.com', settings)).toBe(false);
    expect(canRunOnHost('secure.chase.com', settings)).toBe(false);
    // US-004.3: the popup gets no control that removes a denylisted host.
    expect(toggleHost(settings.allowlist, 'chase.com')).toEqual(settings.allowlist);
    expect(toggleHost(DEFAULT_ALLOWLIST, 'localhost')).toEqual([...DEFAULT_ALLOWLIST]);
  });

  it('US-004 normalizes case, ports, IPv6 brackets and trailing dots', () => {
    expect(normalizeHost('MAIL.Google.com')).toBe('mail.google.com');
    expect(normalizeHost('example.com:8443')).toBe('example.com');
    expect(normalizeHost('[::1]:3000')).toBe('::1');
    expect(normalizeHost('example.com.')).toBe('example.com');
    expect(hostFromUrl('https://sub.example.com/path?a=1')).toBe('sub.example.com');
    expect(hostFromUrl('not a url')).toBe('');
    expect(hostFromUrl(undefined)).toBe('');
  });
});

describe('US-005 allowlist starts small', () => {
  it('US-005 first install allowlists only the five sites plus w/o/m cousins', () => {
    const bases = ['x.com', 'twitter.com', 'reddit.com', 'news.ycombinator.com', 'youtube.com'];
    for (const base of bases) {
      for (const host of [base, `www.${base}`, `old.${base}`, `m.${base}`]) {
        expect(isAllowlisted(host, DEFAULT_ALLOWLIST), host).toBe(true);
      }
    }
    for (const host of ['example.com', 'www.example.com', 'threads.net', 'mobile.x.com']) {
      expect(isAllowlisted(host, DEFAULT_ALLOWLIST), host).toBe(false);
    }
    expect(new Set(DEFAULT_ALLOWLIST).size).toBe(DEFAULT_ALLOWLIST.length);
  });

  it('US-005 unknown hosts are not allowlisted, x.com cousins are', () => {
    expect(isAllowlisted('www.x.com', DEFAULT_ALLOWLIST)).toBe(true);
    expect(isAllowlisted('old.reddit.com', DEFAULT_ALLOWLIST)).toBe(true);
    expect(isAllowlisted('m.youtube.com', DEFAULT_ALLOWLIST)).toBe(true);
    expect(isAllowlisted('news.ycombinator.com', DEFAULT_ALLOWLIST)).toBe(true);
    expect(isAllowlisted('example.com', DEFAULT_ALLOWLIST)).toBe(false);
  });

  it('US-005 toggleHost adds the current host and removes it again', () => {
    const withHost = toggleHost(DEFAULT_ALLOWLIST, 'example.com');
    expect(withHost).toContain('example.com');
    const without = toggleHost(withHost, 'example.com');
    expect(without).not.toContain('example.com');
    expect(toggleHost(without, 'EXAMPLE.com')).toContain('example.com');
  });

  it('US-005 canRunOnHost requires master on, allowlist hit, and no deny', () => {
    const base = { masterEnabled: true, allowlist: [...DEFAULT_ALLOWLIST] };
    expect(canRunOnHost('x.com', base)).toBe(true);
    expect(canRunOnHost('example.com', base)).toBe(false);
    expect(canRunOnHost('x.com', { ...base, masterEnabled: false })).toBe(false);
    expect(canRunOnHost('x.com', { ...base, allowlist: [] })).toBe(false);
    expect(canRunOnHost('', base)).toBe(false);
  });

  it('US-004 the shipped denylist covers every story-named category', () => {
    const required = [
      'gmail',
      'outlook',
      'fastmail',
      'proton',
      'chase',
      'bofa',
      'wellsfargo',
      'usbank',
      'capitalone',
      'fidelity',
      'vanguard',
      'schwab',
      'paypal',
      'venmo',
      '1password',
      'bitwarden',
      'lastpass',
      'dashlane',
      'localhost',
      '127.0.0.1',
    ];
    const joined = HARD_DENYLIST.join(' ');
    for (const name of required) {
      expect(joined, name).toContain(name);
    }
  });
});

describe('US-001 example rules', () => {
  it('US-001 ships three named example rules, all disabled', () => {
    expect(EXAMPLE_RULES.map((rule) => rule.id)).toEqual([
      'political-argument-explainers',
      'rage-bait',
      'reply-guy',
    ]);
    expect(EXAMPLE_RULES.every((rule) => rule.enabled === false)).toBe(true);
    expect(EXAMPLE_RULES.some((rule) => /except|explainer/i.test(rule.instructions))).toBe(true);
  });
});