/** Rule face on a collapsed bar. `collapse` keeps the bar plain. */
export type Face = 'collapse' | 'kitten' | 'meme';

/** One named English rule the operator wrote. */
export interface Rule {
  /** Stable slug; used as the Jev question id. */
  id: string;
  /** Short name shown on the collapsed bar. */
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
  | 'no_rule_matched';

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
  | { verdict: 'leave'; reason: LeaveReason };

/** Per-tab engine state the content script needs. */
export interface EngineState {
  host: string;
  masterEnabled: boolean;
  allowed: boolean;
  denied: boolean;
  enabledRules: number;
  keyPresent: boolean;
}