import { DEFAULT_ALLOWLIST, EXAMPLE_RULES } from './defaults';
import { normalizeHost } from './hosts';
import type { Face, Rule, Settings } from './types';

const FACES: readonly Face[] = ['collapse', 'kitten', 'meme'];
const RULE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Non-secret settings shape. The OpenRouter key lives in `src/jev/key.ts`. */
export const SETTINGS_KEYS = ['masterEnabled', 'rules', 'allowlist'] as const;

export function defaultSettings(): Settings {
  return {
    masterEnabled: true,
    rules: EXAMPLE_RULES.map((rule) => ({ ...rule })),
    allowlist: [...DEFAULT_ALLOWLIST],
  };
}

/** Drops anything that is not a well-formed rule; ids must be unique slugs. */
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
      face: FACES.includes(candidate.face as Face) ? (candidate.face as Face) : 'collapse',
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
  const allowlist = Array.isArray(raw.allowlist)
    ? dedupeHosts(raw.allowlist)
    : base.allowlist;
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

/** Called on install: materializes defaults so the options page has rows. */
export async function ensureDefaults(): Promise<Settings> {
  const raw = await chrome.storage.local.get([...SETTINGS_KEYS]);
  const merged = mergeSettings(raw as Record<string, unknown>);
  await chrome.storage.local.set({
    masterEnabled: merged.masterEnabled,
    rules: merged.rules,
    allowlist: merged.allowlist,
  });
  return merged;
}