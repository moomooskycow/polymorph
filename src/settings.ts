import { DEFAULT_ALLOWLIST, EXAMPLE_RULES } from './defaults';
import { normalizeHost } from './hosts';
import type { Rule, Settings } from './types';

const RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Non-secret settings shape. The OpenRouter key lives in `src/jev/key.ts`;
 * replacement media lives in IndexedDB (`src/media/`), not in this object.
 */
export const SETTINGS_KEYS = ['masterEnabled', 'rules', 'allowlist'] as const;

export function defaultSettings(): Settings {
  return {
    masterEnabled: true,
    rules: EXAMPLE_RULES.map((rule) => ({ ...rule })),
    allowlist: [...DEFAULT_ALLOWLIST],
  };
}

/**
 * US-014 migration: old rule shapes are tolerated. Legacy `face`/`kitten`/
 * `replacementMix` values are dropped, never interpreted as enable flags.
 */
export function sanitizeRules(input: unknown): Rule[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const rules: Rule[] = [];
  for (const raw of input) {
    if (raw === null || typeof raw !== 'object') continue;
    const candidate = raw as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const instructions =
      typeof candidate.instructions === 'string' ? candidate.instructions.trim() : '';
    if (!RULE_ID.test(id) || !name || !instructions || seen.has(id)) continue;
    seen.add(id);
    rules.push({
      id,
      name,
      instructions,
      enabled: candidate.enabled === true,
    });
  }
  return rules;
}

/** Pure merge used on read; keeps defaults when a key is missing or invalid. */
export function mergeSettings(raw: Record<string, unknown>): Settings {
  const base = defaultSettings();
  const masterEnabled =
    typeof raw.masterEnabled === 'boolean' ? raw.masterEnabled : base.masterEnabled;
  const rules = Array.isArray(raw.rules) ? sanitizeRules(raw.rules) : base.rules;
  const allowlist = Array.isArray(raw.allowlist) ? dedupeHosts(raw.allowlist) : base.allowlist;
  return { masterEnabled, rules, allowlist };
}

function dedupeHosts(input: unknown[]): string[] {
  const seen = new Set<string>();
  for (const entry of input) {
    if (typeof entry === 'string') {
      const host = normalizeHost(entry);
      if (host) seen.add(host);
    }
  }
  return [...seen];
}

/**
 * US-001 architecture decision: defaults are virtual. `mergeSettings` merges
 * them into every read; nothing materializes them in storage at install time.
 * The old install-time writer had a TOCTOU window (read an empty snapshot, an
 * external write lands, the writer stores defaults and clobbers it). Readers
 * cannot clobber anything.
 */
export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get([...SETTINGS_KEYS]);
  return mergeSettings(raw as Record<string, unknown>);
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}