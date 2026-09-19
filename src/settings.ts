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

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get([...SETTINGS_KEYS]);
  return mergeSettings(raw as Record<string, unknown>);
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

/**
 * US-001 install safety: only fill keys that are genuinely missing. A user (or
 * the QA harness) can write settings while chrome.runtime.onInstalled is still
 * running; those writes must never be clobbered by the defaults.
 */
export function missingDefaults(raw: Record<string, unknown>): Partial<Settings> {
  const base = defaultSettings();
  const patch: Partial<Settings> = {};
  if (typeof raw.masterEnabled !== 'boolean') patch.masterEnabled = base.masterEnabled;
  if (!Array.isArray(raw.rules)) patch.rules = base.rules;
  if (!Array.isArray(raw.allowlist)) patch.allowlist = base.allowlist;
  return patch;
}

/** Called on install: materializes defaults so the options page has rows. */
export async function ensureDefaults(): Promise<Settings> {
  const raw = await chrome.storage.local.get([...SETTINGS_KEYS]);
  const loaded = raw as Record<string, unknown>;
  const patch = missingDefaults(loaded);
  if (Object.keys(patch).length > 0) await chrome.storage.local.set(patch);
  return mergeSettings({ ...loaded, ...patch });
}