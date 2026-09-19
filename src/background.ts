import { MAX_INFLIGHT_JEV_CALLS } from './defaults';
import { canRunOnHost, hostFromUrl, isDenylisted } from './hosts';
import { DecisionCache, hashText } from './jev/cache';
import { buildJevBody, parseAnswers, requestJev } from './jev/client';
import { clearKey, hasKey, loadKey, saveKey } from './jev/key';
import { normalizeText, precheck } from './jev/precheck';
import { Limiter } from './jev/queue';
import { enabledRules, pickMatch, questionsForRules } from './policy';
import { ensureDefaults, loadSettings } from './settings';
import type { Decision, EngineState, Rule } from './types';

/**
 * US-001: the service worker is the only process that reads the key or calls
 * OpenRouter. Page text only arrives here through `classify` messages from
 * our own content script, and the host is re-checked before any Jev call.
 */
const cache = new DecisionCache();
const limiter = new Limiter(MAX_INFLIGHT_JEV_CALLS);
const inFlight = new Map<string, Promise<Decision>>();
const collapsedByTab = new Map<number, number>();
const CACHE_STORAGE = 'decisionCache';
let cacheHydrated = false;

type Message =
  | { type: 'classify'; text: string }
  | { type: 'getState' }
  | { type: 'getStats'; tabId?: number }
  | { type: 'hasKey' }
  | { type: 'setKey'; key: string }
  | { type: 'clearKey' }
  | { type: 'reportCollapse' }
  | { type: 'reportRestore' };

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const relevant =
    'masterEnabled' in changes ||
    'rules' in changes ||
    'allowlist' in changes ||
    'openrouterKey' in changes;
  if (relevant) void notifyTabs();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  collapsedByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') collapsedByTab.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message as Message, sender).then(sendResponse, (error: unknown) => {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  });
  // Keep the message channel open for the async handlers.
  return true;
});

async function notifyTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'settingsChanged' });
      } catch {
        // No content script in that tab; nothing to notify.
      }
    }),
  );
}

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'classify':
      return classify(message.text, sender);
    case 'getState':
      return engineState(sender);
    case 'getStats': {
      const tabId = message.tabId ?? sender.tab?.id;
      return { collapsed: tabId === undefined ? 0 : (collapsedByTab.get(tabId) ?? 0) };
    }
    case 'hasKey':
      return { hasKey: await hasKey() };
    case 'setKey':
      await saveKey(message.key);
      return { ok: true };
    case 'clearKey':
      await clearKey();
      return { ok: true };
    case 'reportCollapse':
      bumpCollapsed(sender, 1);
      return { ok: true };
    case 'reportRestore':
      bumpCollapsed(sender, -1);
      return { ok: true };
    default:
      return { error: 'unknown message' };
  }
}

async function engineState(sender: chrome.runtime.MessageSender): Promise<EngineState> {
  const host = hostFromUrl(sender.tab?.url ?? sender.url);
  const settings = await loadSettings();
  const keyPresent = await hasKey();
  const denied = isDenylisted(host);
  return {
    host,
    masterEnabled: settings.masterEnabled,
    allowed: !denied && canRunOnHost(host, settings) && keyPresent,
    denied,
    enabledRules: enabledRules(settings.rules).length,
    keyPresent,
  };
}

async function classify(rawText: string, sender: chrome.runtime.MessageSender): Promise<Decision> {
  const host = hostFromUrl(sender.tab?.url ?? sender.url);
  const settings = await loadSettings();
  const key = await loadKey();
  const text = normalizeText(rawText);

  const stop = precheck({ host, settings, keyPresent: key.length > 0, text });
  if (stop !== null) return stop;

  const rules = enabledRules(settings.rules);

  await hydrateCache();
  const hash = await hashText(text);
  const cached = cache.get(hash);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(hash);
  if (pending !== undefined) return pending;

  const task = limiter.run(() => decide({ key, host, text, hash, rules }));
  inFlight.set(hash, task);
  try {
    return await task;
  } finally {
    inFlight.delete(hash);
  }
}

async function decide(args: {
  key: string;
  host: string;
  text: string;
  hash: string;
  rules: Rule[];
}): Promise<Decision> {
  const body = buildJevBody({
    host: args.host,
    text: args.text,
    questions: questionsForRules(args.rules),
  });
  const payload = await requestJev({ apiKey: args.key, body });
  const answers = payload === null ? null : parseAnswers(payload);
  if (answers === null) return { verdict: 'leave', reason: 'jev_error' };

  const match = pickMatch(answers, args.rules);
  const decision: Decision =
    match === null
      ? { verdict: 'leave', reason: 'no_rule_matched' }
      : {
          verdict: 'collapse',
          ruleId: match.rule.id,
          ruleName: match.rule.name,
          face: match.rule.face,
          probability: match.probability,
          confidence: match.confidence,
        };
  cache.set(args.hash, decision);
  void persistCache();
  return decision;
}

function bumpCollapsed(sender: chrome.runtime.MessageSender, delta: number): void {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  collapsedByTab.set(tabId, Math.max(0, (collapsedByTab.get(tabId) ?? 0) + delta));
}

/** US-006: the cache outlives a suspended worker via chrome.storage.session. */
async function hydrateCache(): Promise<void> {
  if (cacheHydrated) return;
  cacheHydrated = true;
  try {
    const raw = await chrome.storage.session.get(CACHE_STORAGE);
    const data = raw[CACHE_STORAGE];
    if (data !== null && typeof data === 'object') {
      cache.restore(data as Record<string, Decision>);
    }
  } catch {
    // Session storage unavailable; the in-memory cache still works.
  }
}

async function persistCache(): Promise<void> {
  try {
    await chrome.storage.session.set({ [CACHE_STORAGE]: cache.snapshot() });
  } catch {
    // Non-fatal: the in-memory cache is authoritative for this worker.
  }
}