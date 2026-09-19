import { Backoff } from './backoff';
import { MAX_INFLIGHT_JEV_CALLS } from './defaults';
import {
  DiagnosticRing,
  type DiagnosticEvent,
  type DiagnosticsSnapshot,
  type ErrorKind,
  type OutcomeKind,
  type TabDiagnostics,
} from './diagnostics';
import { canRunOnHost, hostFromUrl, isDenylisted } from './hosts';
import { DecisionCache, hashText } from './jev/cache';
import { buildJevBody, isRetryableFailure, parseAnswers, requestJevDetailed } from './jev/client';
import { clearKey, hasKey, loadKey, saveKey } from './jev/key';
import { normalizeText, precheck } from './jev/precheck';
import { Limiter } from './jev/queue';
import { base64ToBytes } from './media/bytes';
import { decodeRaster, makeThumbnail } from './media/browser';
import { MediaService } from './media/service';
import { IdbMediaStore } from './media/store';
import { emptyUsage } from './media/types';
import { enabledRules, pickMatch, questionForRule, questionsForRules } from './policy';
import { ensureDefaults, loadSettings } from './settings';
import { emptyCounters, type Decision, type EngineState, type Rule, type TabCounters } from './types';

/**
 * US-001: the service worker is the only process that reads the key or calls
 * OpenRouter. US-010: it also owns the provider backoff. US-011: it aggregates
 * per-tab counters and the redacted outcome ring.
 */
const cache = new DecisionCache();
const limiter = new Limiter(MAX_INFLIGHT_JEV_CALLS);
const inFlight = new Map<string, Promise<Decision>>();
const backoff = new Backoff();
const ring = new DiagnosticRing();
const statsByTab = new Map<number, TabDiagnostics>();

/**
 * Session totals: counters that survive closing a tab, so the diagnostics
 * page never shows zero counters above real outcome log lines. Persisted to
 * chrome.storage.session; cleared when the browser closes, on Clear, and it
 * tracks per-tab deltas so re-reports do not double count.
 */
const TOTALS_STORAGE = 'polymorph:totals:v1';
interface TotalsState {
  totals: TabCounters;
  perTab: Record<string, TabCounters>;
}
let totalsState: TotalsState | null = null;
let statsChain: Promise<void> = Promise.resolve();

async function hydrateTotals(): Promise<TotalsState> {
  if (totalsState !== null) return totalsState;
  const state: TotalsState = { totals: emptyCounters(), perTab: {} };
  try {
    const raw = await chrome.storage.session.get(TOTALS_STORAGE);
    const data = raw[TOTALS_STORAGE] as TotalsState | undefined;
    if (data !== null && typeof data === 'object') {
      const totals = data.totals as unknown as Record<string, unknown> | undefined;
      if (totals !== null && typeof totals === 'object') {
        for (const key of COUNTER_KEYS) {
          const v = totals[key];
          state.totals[key] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
        }
      }
      const perTab = data.perTab;
      if (perTab !== null && typeof perTab === 'object') {
        for (const [tabId, counters] of Object.entries(perTab)) {
          const clean = emptyCounters();
          const rawCounters = counters as unknown as Record<string, unknown>;
          for (const key of COUNTER_KEYS) {
            const v = rawCounters?.[key];
            clean[key] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
          }
          state.perTab[tabId] = clean;
        }
      }
    }
  } catch {
    // Session storage unavailable; in-memory totals still work.
  }
  totalsState = state;
  return state;
}

function persistTotals(): void {
  if (totalsState === null) return;
  void chrome.storage.session.set({ [TOTALS_STORAGE]: totalsState }).catch(() => {});
}

async function forgetTabTotals(tabId: number): Promise<void> {
  const state = await hydrateTotals();
  if (state.perTab[String(tabId)] !== undefined) {
    delete state.perTab[String(tabId)];
    persistTotals();
  }
}

async function resetTotals(): Promise<void> {
  const state = await hydrateTotals();
  state.totals = emptyCounters();
  state.perTab = {};
  persistTotals();
}
const CACHE_STORAGE = 'decisionCache';
const DIAGNOSTICS_STORAGE = 'diagnosticsRing';
const TEST_TIMEOUT_MS = 10_000;
let cacheHydrated = false;
let diagnosticsHydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

type Message =
  | { type: 'classify'; text: string }
  | { type: 'getState' }
  | { type: 'getTabStats'; tabId?: number }
  | { type: 'hasKey' }
  | { type: 'setKey'; key: string }
  | { type: 'clearKey' }
  | { type: 'testKey' }
  | { type: 'reportStats'; stats: TabCounters }
  | { type: 'reportEvent'; event: Partial<DiagnosticEvent> }
  | { type: 'getDiagnostics' }
  | { type: 'clearDiagnostics' }
  | { type: 'media:list' }
  | { type: 'media:add'; mime?: string; base64?: string }
  | { type: 'media:remove'; id: string }
  | { type: 'media:clear' }
  | { type: 'media:pick'; key: string; recent?: string[] };

const COUNTER_KEYS: readonly (keyof TabCounters)[] = [
  'discovered',
  'queued',
  'evaluated',
  'transformed',
  'skipped',
  'errors',
  'restored',
];

const OUTCOMES: readonly OutcomeKind[] = [
  'queued',
  'evaluated',
  'transformed',
  'left',
  'skipped',
  'restored',
  'deferred',
  'error',
  'connection_test',
];

const ERROR_KINDS: readonly ErrorKind[] = ['http', 'network', 'timeout', 'parse', 'no_key'];

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
  if (relevant) void notifyTabs({ type: 'settingsChanged' });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  statsByTab.delete(tabId);
  void forgetTabTotals(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') { statsByTab.delete(tabId); void forgetTabTotals(tabId); }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message as Message, sender).then(sendResponse, (error: unknown) => {
    sendResponse({ error: error instanceof Error ? error.message : String(error) });
  });
  // Keep the message channel open for the async handlers.
  return true;
});

async function notifyTabs(message: { type: string }): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await chrome.tabs.sendMessage(tab.id, message);
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
    case 'getTabStats': {
      const tabId = message.tabId ?? sender.tab?.id;
      const entry = tabId === undefined ? undefined : statsByTab.get(tabId);
      return { transformed: entry?.counters.transformed ?? 0, counters: entry?.counters ?? emptyCounters() };
    }
    case 'hasKey':
      return { hasKey: await hasKey() };
    case 'setKey':
      await saveKey(message.key);
      return { ok: true };
    case 'clearKey':
      await clearKey();
      return { ok: true };
    case 'testKey':
      return testConnection();
    case 'reportStats':
      statsChain = statsChain.then(() => reportStats(message.stats, sender));
      return { ok: true };
    case 'reportEvent':
      reportEvent(message.event, sender);
      return { ok: true };
    case 'getDiagnostics':
      return diagnosticsSnapshot(sender);
    case 'clearDiagnostics':
      ring.clear();
      statsByTab.clear();
      void resetTotals();
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      void persistDiagnostics();
      return { ok: true };
    case 'media:list':
      return mediaList();
    case 'media:add':
      return mediaAdd(message);
    case 'media:remove':
      return mediaRemove(message.id);
    case 'media:clear':
      return mediaClear();
    case 'media:pick':
      return mediaPick(message.key, message.recent ?? []);
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

  const now = Date.now();
  if (backoff.isPaused(now)) {
    return { verdict: 'leave', reason: 'backoff', retryAfterMs: backoff.retryAfterMs(now) };
  }

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
  const startedAt = Date.now();
  const result = await requestJevDetailed({ apiKey: args.key, body });
  const durationMs = Date.now() - startedAt;

  if (!result.ok) {
    if (isRetryableFailure(result)) {
      const retryAfterMs = backoff.noteFailure();
      recordEvent({
        host: args.host,
        outcome: 'error',
        errorKind: result.kind,
        durationMs,
        textLength: args.text.length,
      });
      return { verdict: 'leave', reason: 'backoff', retryAfterMs };
    }
    recordEvent({
      host: args.host,
      outcome: 'error',
      errorKind: result.kind,
      durationMs,
      textLength: args.text.length,
    });
    return { verdict: 'leave', reason: 'jev_error' };
  }

  backoff.noteSuccess();
  const answers = parseAnswers(result.payload);
  if (answers === null) {
    recordEvent({
      host: args.host,
      outcome: 'error',
      errorKind: 'parse',
      durationMs,
      textLength: args.text.length,
    });
    return { verdict: 'leave', reason: 'jev_error' };
  }

  const match = pickMatch(answers, args.rules);
  const decision: Decision =
    match === null
      ? { verdict: 'leave', reason: 'no_rule_matched' }
      : {
          verdict: 'collapse',
          ruleId: match.rule.id,
          ruleName: match.rule.name,
          probability: match.probability,
          confidence: match.confidence,
        };
  cache.set(args.hash, decision);
  void persistCache();
  return decision;
}

/** US-005 in options: one bounded real call with fixed synthetic text. */
async function testConnection(): Promise<{
  ok: boolean;
  ms: number;
  errorKind?: ErrorKind;
  status?: number;
}> {
  const key = await loadKey();
  if (key.length === 0) return { ok: false, ms: 0, errorKind: 'no_key' };

  const rule: Rule = {
    id: 'connection-test',
    name: 'Connection test',
    instructions:
      'Fixed synthetic test. Match if the text mentions Polymorph; otherwise no_match.',
    enabled: true,
  };
  const body = buildJevBody({
    host: 'polymorph.local',
    text: 'Polymorph connection test. This is fixed synthetic text and contains no page content.',
    questions: { 'connection-test': questionForRule(rule) },
  });
  const startedAt = Date.now();
  const result = await requestJevDetailed({ apiKey: key, body, timeoutMs: TEST_TIMEOUT_MS });
  const ms = Date.now() - startedAt;
  if (!result.ok) {
    recordEvent({ host: 'connection-test', outcome: 'connection_test', errorKind: result.kind, durationMs: ms });
    return { ok: false, ms, ...(result.status === undefined ? {} : { status: result.status }), errorKind: result.kind };
  }
  backoff.noteSuccess();
  recordEvent({ host: 'connection-test', outcome: 'connection_test', durationMs: ms });
  return { ok: true, ms };
}

async function reportStats(raw: TabCounters, sender: chrome.runtime.MessageSender): Promise<void> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || raw === null || typeof raw !== 'object') return;
  const counters = emptyCounters();
  for (const key of COUNTER_KEYS) {
    const value = raw[key];
    counters[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  statsByTab.set(tabId, {
    tabId,
    host: hostFromUrl(sender.tab?.url ?? sender.url),
    counters,
    lastAt: Date.now(),
  });
  const state = await hydrateTotals();
  const prev = state.perTab[String(tabId)] ?? emptyCounters();
  for (const key of COUNTER_KEYS) {
    const delta = counters[key] - prev[key];
    if (delta > 0) state.totals[key] += delta;
  }
  state.perTab[String(tabId)] = counters;
  persistTotals();
}

function reportEvent(raw: Partial<DiagnosticEvent>, sender: chrome.runtime.MessageSender): void {
  if (raw === null || typeof raw !== 'object') return;
  const outcome = OUTCOMES.includes(raw.outcome as OutcomeKind) ? (raw.outcome as OutcomeKind) : null;
  if (outcome === null) return;
  const errorKind =
    raw.errorKind !== undefined && ERROR_KINDS.includes(raw.errorKind) ? raw.errorKind : undefined;
  recordEvent({
    host: hostFromUrl(sender.tab?.url ?? sender.url),
    outcome,
    ...(typeof raw.ruleId === 'string' ? { ruleId: raw.ruleId.slice(0, 80) } : {}),
    ...(typeof raw.assetId === 'string' ? { assetId: raw.assetId.slice(0, 80) } : {}),
    ...(typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
      ? { durationMs: Math.max(0, Math.round(raw.durationMs)) }
      : {}),
    ...(typeof raw.textLength === 'number' && Number.isFinite(raw.textLength)
      ? { textLength: Math.max(0, Math.floor(raw.textLength)) }
      : {}),
    ...(errorKind === undefined ? {} : { errorKind }),
  });
}

function recordEvent(event: Omit<DiagnosticEvent, 'at'>): void {
  ring.push({ ...event, at: Date.now() });
  schedulePersist();
}

/** Diagnostics writes are debounced; a busy feed must not spam session storage. */
function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistDiagnostics();
  }, 1_000);
}

async function diagnosticsSnapshot(sender: chrome.runtime.MessageSender): Promise<DiagnosticsSnapshot> {
  await hydrateDiagnostics();
  const host = hostFromUrl(sender.tab?.url ?? sender.url);
  const settings = await loadSettings();
  const keyPresent = await hasKey();
  const totals = (await hydrateTotals()).totals;
  const now = Date.now();
  return {
    version: chrome.runtime.getManifest().version,
    generatedAt: now,
    paused: backoff.isPaused(now),
    pausedForMs: backoff.retryAfterMs(now),
    activeRules: enabledRules(settings.rules).map((rule) => rule.name),
    totals,
    currentSite: {
      host,
      allowed: !isDenylisted(host) && canRunOnHost(host, settings) && keyPresent,
      denied: isDenylisted(host),
      masterEnabled: settings.masterEnabled,
    },
    tabs: [...statsByTab.values()],
    recent: ring.list(),
  };
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

async function hydrateDiagnostics(): Promise<void> {
  if (diagnosticsHydrated) return;
  diagnosticsHydrated = true;
  try {
    const raw = await chrome.storage.session.get(DIAGNOSTICS_STORAGE);
    const data = raw[DIAGNOSTICS_STORAGE];
    if (Array.isArray(data)) ring.restore(data as DiagnosticEvent[]);
  } catch {
    // Session storage unavailable; diagnostics stay in memory.
  }
}

async function persistDiagnostics(): Promise<void> {
  try {
    await chrome.storage.session.set({ [DIAGNOSTICS_STORAGE]: ring.list() });
  } catch {
    // Non-fatal.
  }
}
/* ------------------------------------------------------------------ media */

let mediaServicePromise: Promise<MediaService> | null = null;

async function mediaService(): Promise<MediaService> {
  if (mediaServicePromise === null) {
    mediaServicePromise = IdbMediaStore.open()
      .then((store) => new MediaService({ store, decode: decodeRaster, makeThumb: makeThumbnail }))
      .catch((error: unknown) => {
        mediaServicePromise = null;
        throw error;
      });
  }
  return mediaServicePromise;
}

const STORE_UNAVAILABLE = { issue: 'store_unavailable' as const };

async function mediaList(): Promise<unknown> {
  try {
    const service = await mediaService();
    return { ok: true, ...(await service.list()) };
  } catch {
    return { ok: false, ...STORE_UNAVAILABLE, assets: [], usage: emptyUsage() };
  }
}

async function mediaAdd(message: { mime?: string; base64?: string }): Promise<unknown> {
  if (typeof message.base64 !== 'string' || typeof message.mime !== 'string') {
    return { ok: false, issue: 'unsupported', message: 'Missing file data.' };
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(message.base64);
  } catch {
    return { ok: false, issue: 'unsupported', message: 'The file data was not valid.' };
  }
  try {
    const service = await mediaService();
    const result = await service.add({ mime: message.mime, bytes });
    if (result.ok) void notifyTabs({ type: 'mediaChanged' });
    return result;
  } catch {
    return { ok: false, ...STORE_UNAVAILABLE, message: 'The media library is unavailable.' };
  }
}

async function mediaRemove(id: string): Promise<unknown> {
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, removed: false, usage: emptyUsage() };
  }
  try {
    const service = await mediaService();
    const result = await service.remove(id);
    if (result.ok) void notifyTabs({ type: 'mediaChanged' });
    return { ok: true, removed: result.ok, usage: result.usage };
  } catch {
    return { ok: false, removed: false, usage: emptyUsage() };
  }
}

async function mediaClear(): Promise<unknown> {
  try {
    const service = await mediaService();
    const usage = await service.clear();
    void notifyTabs({ type: 'mediaChanged' });
    return { ok: true, usage };
  } catch {
    return { ok: false, usage: emptyUsage() };
  }
}

async function mediaPick(key: string, recent: string[]): Promise<unknown> {
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, issue: 'unsupported' };
  }
  try {
    const service = await mediaService();
    return await service.pick(key, recent.slice(0, 64).map(String));
  } catch {
    return { ok: false, ...STORE_UNAVAILABLE };
  }
}
