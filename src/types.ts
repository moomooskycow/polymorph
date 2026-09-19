/** Where a transformed post's art comes from. */
export type Category = 'cute' | 'meme' | 'motivation';

/**
 * Global replacement mix. `collapse` is the v1 behavior (plain bar, no art).
 */
export type ReplacementMix = 'mixed' | 'collapse' | Category;

/**
 * Per-rule override. `inherit` uses the global mix. `kitten` is a v1 alias
 * that normalizes to `cute`.
 */
export type Face = 'inherit' | 'collapse' | Category;

/** One named English rule the operator wrote. */
export interface Rule {
  /** Stable slug; used as the Jev question id. */
  id: string;
  /** Short name shown on the card. */
  name: string;
  /** Full English instruction sent to Jev. */
  instructions: string;
  enabled: boolean;
  face: Face;
}

/** Everything the engine needs except the OpenRouter key. */
export interface Settings {
  masterEnabled: boolean;
  rules: Rule[];
  allowlist: string[];
  replacementMix: ReplacementMix;
}

/** Why a post was left visible. Never user-facing in detail. */
export type LeaveReason =
  | 'denylisted'
  | 'not_allowlisted'
  | 'master_disabled'
  | 'no_rules_enabled'
  | 'no_key'
  | 'skipped_short'
  | 'jev_error'
  | 'no_rule_matched'
  | 'backoff';

/** Background's answer to one classify request. */
export type Decision =
  | {
      verdict: 'collapse';
      ruleId: string;
      ruleName: string;
      face: Face;
      probability: number;
      confidence: number;
    }
  | { verdict: 'leave'; reason: LeaveReason; retryAfterMs?: number };

/** Per-tab engine state the content script needs. */
export interface EngineState {
  host: string;
  masterEnabled: boolean;
  allowed: boolean;
  denied: boolean;
  enabledRules: number;
  keyPresent: boolean;
  replacementMix: ReplacementMix;
}

/** Cumulative per-tab engine counters (genuinely measured by content.ts). */
export interface TabCounters {
  discovered: number;
  queued: number;
  evaluated: number;
  transformed: number;
  skipped: number;
  errors: number;
  restored: number;
}

export function emptyCounters(): TabCounters {
  return { discovered: 0, queued: 0, evaluated: 0, transformed: 0, skipped: 0, errors: 0, restored: 0 };
}