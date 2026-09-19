import { MIN_POST_CHARS } from '../defaults';
import { canRunOnHost, isDenylisted } from '../hosts';
import { enabledRules } from '../policy';
import type { Decision, Settings } from '../types';

export interface PrecheckInput {
  host: string;
  settings: Pick<Settings, 'masterEnabled' | 'allowlist' | 'rules'>;
  keyPresent: boolean;
  text: string;
}

export function normalizeText(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Every reason to leave a post visible before any Jev call. Returns null only
 * when the host is allowed, at least one rule is enabled, and a key exists.
 *
 * US-001.3 no enabled rule means no Jev. US-004 denylist wins over allowlist
 * and master. US-005 master off or host not allowlisted means no Jev.
 */
export function precheck(input: PrecheckInput): Decision | null {
  const host = input.host;
  if (!host || isDenylisted(host)) return { verdict: 'leave', reason: 'denylisted' };
  if (!input.settings.masterEnabled) return { verdict: 'leave', reason: 'master_disabled' };
  if (!canRunOnHost(host, input.settings)) return { verdict: 'leave', reason: 'not_allowlisted' };
  if (enabledRules(input.settings.rules).length === 0) {
    return { verdict: 'leave', reason: 'no_rules_enabled' };
  }
  if (!input.keyPresent) return { verdict: 'leave', reason: 'no_key' };
  if (normalizeText(input.text).length < MIN_POST_CHARS) {
    return { verdict: 'leave', reason: 'skipped_short' };
  }
  return null;
}