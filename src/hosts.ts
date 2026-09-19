import type { Settings } from './types';

/**
 * US-004 hard denylist. Subdomains match too (`secure.chase.com`, `mail.google.com`).
 * Nothing on this list is overridable from the popup.
 */
export const HARD_DENYLIST: readonly string[] = [
  // Mail
  'gmail.com',
  'mail.google.com',
  'outlook.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'hotmail.com',
  'fastmail.com',
  'fastmail.fm',
  'app.fastmail.com',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'mail.proton.me',
  // US banks and brokers
  'chase.com',
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
  // Password managers
  '1password.com',
  'bitwarden.com',
  'lastpass.com',
  'dashlane.com',
  // Local surfaces
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
];

/** Lowercases, strips a port and IPv6 brackets, and drops a trailing dot. */
export function normalizeHost(input: string | null | undefined): string {
  if (!input) return '';
  let host = input.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    host = end === -1 ? host.slice(1) : host.slice(1, end);
  } else if (host.includes(':')) {
    const first = host.indexOf(':');
    const last = host.lastIndexOf(':');
    // A single colon is a port. Multiple colons mean a bare IPv6 literal.
    if (first === last) host = host.slice(0, first);
  }
  return host.replace(/\.+$/, '');
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** US-004: check this before any DOM read on a page. */
export function isDenylisted(input: string | null | undefined): boolean {
  const host = normalizeHost(input);
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return HARD_DENYLIST.some((domain) => matchesDomain(host, domain));
}

/** US-005: exact host match; the default list spells out its cousins. */
export function isAllowlisted(
  input: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  const host = normalizeHost(input);
  if (!host) return false;
  return allowlist.some((entry) => normalizeHost(entry) === host);
}

/** The single predicate the engine consults before scraping or calling Jev. */
export function canRunOnHost(
  input: string | null | undefined,
  settings: Pick<Settings, 'masterEnabled' | 'allowlist'>,
): boolean {
  const host = normalizeHost(input);
  if (!host || isDenylisted(host)) return false;
  return settings.masterEnabled && isAllowlisted(host, settings.allowlist);
}

/** Adds or removes one exact host. Denylisted hosts are never added. */
export function toggleHost(allowlist: readonly string[], input: string | null | undefined): string[] {
  const host = normalizeHost(input);
  if (!host || isDenylisted(host)) return [...allowlist];
  const normalized = allowlist.map((entry) => normalizeHost(entry));
  if (normalized.includes(host)) {
    return allowlist.filter((entry) => normalizeHost(entry) !== host);
  }
  return [...allowlist, host];
}

export function hostFromUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return '';
  }
}