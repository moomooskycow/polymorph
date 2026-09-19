import {
  adapterForHost,
  closestPost,
  collectPosts,
  collectPostsIn,
  visibleText,
} from './adapters';
import {
  CARD_TAG,
  buildCard,
  isCardNode,
  isInsideCard,
  restorePost,
  transformPost,
  type CardMedia,
  type CardView,
} from './card';
import { MIN_POST_CHARS } from './defaults';
import { isDenylisted, normalizeHost } from './hosts';
import { STATE_ATTR, clearMark, markPost, postSignature, readMark } from './marking';
import { base64ToBytes } from './media/bytes';
import { rememberRecent } from './media/selection';
import { emptyCounters, type Decision, type EngineState, type TabCounters } from './types';

/**
 * US-004: this file's first observable action is the denylist check. On a
 * denylisted host it registers no observer and touches no DOM.
 *
 * US-010: posts are tracked by content signature, scans are incremental, and
 * recycled nodes are re-evaluated. US-014: a matched post draws one image
 * from the operator's local library; an empty library collapses compactly.
 */
let pageHost = normalizeHost(window.location.hostname);
let adapter = adapterForHost(pageHost);
let epoch = 0;
let scanning = false;
let flushScheduled = false;
let deferredTimer: number | null = null;
let statsTimer: number | null = null;
let statsDirty = false;
let observer: MutationObserver | null = null;
let reducedMotion = false;
let recentPicks: string[] = [];
let stats: TabCounters = emptyCounters();
const pendingRoots = new Set<Element>();
const inFlight = new Set<HTMLElement>();

interface TrackedPost {
  view: CardView;
  ruleId: string;
  ruleName: string;
  /** Content signature the decision was made for. */
  sig: string;
  /** Library asset this card drew, if any. */
  assetId: string | null;
}

const tracked = new Map<HTMLElement, TrackedPost>();

interface PickReply {
  ok: boolean;
  empty?: boolean;
  id?: string;
  mime?: string;
  base64?: string;
  issue?: string;
}

interface ResolvedMedia {
  url: string;
  mime: string;
  frozenUrl: string | null;
}

const MEDIA_URL_CACHE_LIMIT = 64;
const mediaUrls = new Map<string, ResolvedMedia>();

function releaseMedia(entry: ResolvedMedia): void {
  URL.revokeObjectURL(entry.url);
  if (entry.frozenUrl !== null && entry.frozenUrl.startsWith('blob:')) {
    URL.revokeObjectURL(entry.frozenUrl);
  }
}

/** LRU-bounded object URLs; revoked on eviction and on page teardown. */
function cacheMedia(id: string, entry: ResolvedMedia): void {
  if (mediaUrls.size >= MEDIA_URL_CACHE_LIMIT) {
    const oldest = mediaUrls.keys().next().value;
    if (oldest !== undefined) {
      const stale = mediaUrls.get(oldest);
      if (stale !== undefined) releaseMedia(stale);
      mediaUrls.delete(oldest);
    }
  }
  mediaUrls.set(id, entry);
}

function touchMedia(id: string, entry: ResolvedMedia): void {
  mediaUrls.delete(id);
  mediaUrls.set(id, entry);
}

window.addEventListener('pagehide', () => {
  for (const entry of mediaUrls.values()) releaseMedia(entry);
  mediaUrls.clear();
});

async function send<T>(message: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

function scheduleStats(): void {
  statsDirty = true;
  if (statsTimer !== null) return;
  statsTimer = window.setTimeout(() => {
    statsTimer = null;
    if (!statsDirty) return;
    statsDirty = false;
    void send({ type: 'reportStats', stats: { ...stats } });
  }, 500);
}

function reportEvent(
  outcome: 'transformed' | 'left' | 'skipped' | 'restored' | 'deferred' | 'error',
  extra: {
    ruleId?: string;
    assetId?: string;
    durationMs?: number;
    errorKind?: 'http' | 'network' | 'timeout' | 'parse';
    textLength?: number;
  } = {},
): void {
  void send({
    type: 'reportEvent',
    event: { at: Date.now(), host: pageHost, outcome, ...extra },
  });
}

/* ------------------------------------------------------------------ media */

/**
 * US-014: draw the asset for this post. The worker holds the pile and the
 * stable-selection rule; this side only turns bytes into a local blob URL.
 * A null return means "no media", which renders the compact collapse card.
 */
async function resolveMedia(
  key: string,
  updateRecency: boolean,
): Promise<{ media: CardMedia | null; assetId: string | null }> {
  const reply = await send<PickReply>({
    type: 'media:pick',
    key,
    recent: recentPicks,
  });
  if (
    reply === null ||
    reply.ok !== true ||
    reply.empty === true ||
    typeof reply.id !== 'string' ||
    typeof reply.mime !== 'string' ||
    typeof reply.base64 !== 'string'
  ) {
    return { media: null, assetId: null };
  }

  let entry = mediaUrls.get(reply.id);
  if (entry === undefined) {
    try {
      const bytes = base64ToBytes(reply.base64);
      entry = {
        url: URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: reply.mime })),
        mime: reply.mime,
        frozenUrl: null,
      };
    } catch {
      return { media: null, assetId: null };
    }
    cacheMedia(reply.id, entry);
  } else {
    touchMedia(reply.id, entry);
  }

  const media = await mediaVariant(entry);
  if (updateRecency) recentPicks = rememberRecent(recentPicks, reply.id);
  if (media === null) return { media: null, assetId: reply.id };
  return { media, assetId: reply.id };
}

/**
 * Reduced-motion GIFs become a first-frame PNG. If the frame cannot be
 * drawn, the caller collapses instead of playing an animation.
 */
async function mediaVariant(entry: ResolvedMedia): Promise<CardMedia | null> {
  if (entry.mime !== 'image/gif' || !reducedMotion) {
    return { url: entry.url, mime: entry.mime, frozen: false };
  }
  if (entry.frozenUrl !== null) {
    return { url: entry.frozenUrl, mime: 'image/png', frozen: true };
  }
  const frozen = await freezeFirstFrame(entry.url);
  if (frozen === null) return null;
  entry.frozenUrl = frozen;
  return { url: frozen, mime: 'image/png', frozen: true };
}

async function freezeFirstFrame(url: string): Promise<string | null> {
  try {
    const image = new Image();
    image.src = url;
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || 1;
    canvas.height = image.naturalHeight || 1;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- scanning */

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    flushRoots();
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 500 });
  } else {
    window.setTimeout(run, 60);
  }
}

/** US-010: flush only changed subtrees, not the whole document. */
function flushRoots(): void {
  if (!scanning) {
    pendingRoots.clear();
    return;
  }
  const roots = [...pendingRoots];
  pendingRoots.clear();
  for (const root of roots) {
    if (!root.isConnected) continue;
    const nearest = closestPost(root, adapter);
    if (nearest !== null) {
      evaluatePost(nearest);
      continue;
    }
    for (const post of collectPostsIn(root, adapter)) evaluatePost(post);
  }
}

function scanFull(): void {
  for (const post of collectPosts(document, adapter)) evaluatePost(post);
}

function start(): void {
  if (!scanning) {
    scanning = true;
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  scanFull();
}

function stop(): void {
  scanning = false;
  observer?.disconnect();
  observer = null;
  pendingRoots.clear();
  if (deferredTimer !== null) {
    window.clearTimeout(deferredTimer);
    deferredTimer = null;
  }
}

/* ------------------------------------------------------------ node handling */

/** US-010: DOM-text hash, stable while the node is hidden behind a card. */
function contentSignature(post: HTMLElement): string {
  return postSignature(post.textContent ?? '');
}

/**
 * US-010: a recycled or edited node is un-transformed and re-evaluated.
 * Transformed nodes compare DOM text content because `innerText` is empty
 * while the post is hidden; other states compare visible text.
 */
function recycleIfChanged(post: HTMLElement): void {
  const mark = readMark(post);
  if (mark === null) return;
  const changed =
    mark.state === 'transformed'
      ? mark.contentSig !== undefined && mark.contentSig !== contentSignature(post)
      : mark.sig !== postSignature(visibleText(post));
  if (!changed) return;
  const entry = tracked.get(post);
  if (entry !== undefined) {
    restorePost(post, entry.view);
    tracked.delete(post);
  }
  clearMark(post);
}

function evaluatePost(post: HTMLElement): void {
  if (post.closest(CARD_TAG) !== null) return;
  const wasUnmarked = readMark(post) === null;
  recycleIfChanged(post);
  // Still marked means nothing about this node's content changed.
  if (readMark(post) !== null) return;

  const text = visibleText(post);
  const sig = postSignature(text);
  if (wasUnmarked) stats.discovered++;

  if (text.length < MIN_POST_CHARS) {
    markPost(post, 'left', sig);
    stats.skipped++;
    scheduleStats();
    reportEvent('skipped', { textLength: text.length });
    return;
  }

  markPost(post, 'pending', sig);
  if (inFlight.has(post)) return;
  inFlight.add(post);
  stats.queued++;
  scheduleStats();
  const mine = epoch;
  const startedAt = performance.now();
  void send<Decision>({ type: 'classify', text }).then((reply) => {
    void applyDecision(post, text, sig, reply, startedAt, mine);
  });
}

async function applyDecision(
  post: HTMLElement,
  text: string,
  sig: string,
  reply: Decision | null,
  startedAt: number,
  mine: number,
): Promise<void> {
  inFlight.delete(post);

  // A settings/host change happened while the call was in flight: the pause
  // must win. Drop the result and let a later scan retry this content.
  if (mine !== epoch) {
    const mark = readMark(post);
    if (mark !== null && mark.state === 'pending') clearMark(post);
    return;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  stats.evaluated++;
  scheduleStats();

  // The node may have been recycled while the call was in flight. Re-queue it
  // with its new content instead of applying a decision for old text.
  if (!post.isConnected || postSignature(visibleText(post)) !== sig) {
    const mark = readMark(post);
    if (mark !== null && mark.state === 'pending') {
      clearMark(post);
      pendingRoots.add(post);
      scheduleFlush();
    }
    return;
  }

  if (reply === null || !('verdict' in reply)) {
    markPost(post, 'left', sig);
    stats.errors++;
    scheduleStats();
    reportEvent('error', { durationMs, textLength: text.length, errorKind: 'network' });
    return;
  }

  if (reply.verdict === 'collapse') {
    const { media, assetId } = await resolveMedia(`${sig}\u0000${reply.ruleId}`, true);

    // resolveMedia is async: re-check that this node is still the same post.
    if (mine !== epoch) return;
    if (!post.isConnected || postSignature(visibleText(post)) !== sig) {
      const mark = readMark(post);
      if (mark !== null && mark.state === 'pending') {
        clearMark(post);
        pendingRoots.add(post);
        scheduleFlush();
      }
      return;
    }

    const view = buildCard({ ruleName: reply.ruleName, media, reducedMotion });
    if (!transformPost(post, view)) {
      markPost(post, 'left', sig);
      return;
    }
    view.showOriginal.addEventListener('click', () => showOriginal(post));
    tracked.set(post, {
      view,
      ruleId: reply.ruleId,
      ruleName: reply.ruleName,
      sig,
      assetId,
    });
    markPost(post, 'transformed', sig, contentSignature(post));
    stats.transformed++;
    scheduleStats();
    reportEvent('transformed', {
      ruleId: reply.ruleId,
      ...(assetId === null ? {} : { assetId }),
      durationMs,
      textLength: text.length,
    });
    return;
  }

  if (reply.reason === 'backoff') {
    markPost(post, 'deferred', sig);
    stats.skipped++;
    scheduleStats();
    reportEvent('deferred', { durationMs, textLength: text.length });
    scheduleDeferredRetry(reply.retryAfterMs ?? 5_000);
    return;
  }

  markPost(post, 'left', sig);
  stats.skipped++;
  scheduleStats();
  if (reply.reason === 'jev_error') {
    stats.errors++;
    scheduleStats();
    reportEvent('error', { durationMs, textLength: text.length, errorKind: 'http' });
  } else {
    reportEvent('skipped', { durationMs, textLength: text.length });
  }
}

/** US-008: "Show original" keeps the post visible for the rest of the page life. */
function showOriginal(post: HTMLElement): void {
  const entry = tracked.get(post);
  if (entry === undefined) return;
  restorePost(post, entry.view);
  tracked.delete(post);
  markPost(post, 'restored', postSignature(visibleText(post)));
  stats.restored++;
  scheduleStats();
  reportEvent('restored', { ruleId: entry.ruleId });
}

/** US-010: pause/disable restores every transformed post (fail-open). */
function restoreAllTracked(clearMarks: boolean): void {
  for (const [post, entry] of tracked) {
    restorePost(post, entry.view);
    if (clearMarks) clearMark(post);
  }
  tracked.clear();
}

/**
 * A pause must not leave half-judged nodes behind. Pending marks are cleared
 * and in-flight slots dropped; the background dedupes any duplicate request
 * by text hash, so this cannot double-call Jev.
 */
function clearPendingMarks(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`[${STATE_ATTR}="pending"]`)) {
    clearMark(el);
  }
  inFlight.clear();
}

function scheduleDeferredRetry(ms: number): void {
  if (deferredTimer !== null) return;
  deferredTimer = window.setTimeout(
    () => {
      deferredTimer = null;
      for (const el of document.querySelectorAll(`[${STATE_ATTR}="deferred"]`)) clearMark(el);
      if (scanning) scanFull();
    },
    Math.max(1_000, Math.min(ms, 60_000)),
  );
}

/* ---------------------------------------------------------------- mutations */

function onMutations(records: MutationRecord[]): void {
  const hostNow = normalizeHost(window.location.hostname);
  if (hostNow !== pageHost) {
    void refresh();
    return;
  }

  for (const record of records) {
    const target = record.target;
    if (isCardNode(target) || isInsideCard(target)) continue;
    if (record.type === 'characterData') {
      const parent = target.parentElement;
      if (parent !== null) pendingRoots.add(parent);
      continue;
    }
    // The changed parent itself may be (or contain) the post whose content
    // was swapped, e.g. `post.textContent = ...` replaces a text child.
    if (target instanceof Element) pendingRoots.add(target);
    for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const element = node as Element;
      if (isCardNode(element) || isInsideCard(element)) continue;
      pendingRoots.add(element);
    }
  }
  if (pendingRoots.size > 0) scheduleFlush();
}

/* ------------------------------------------------------------------ lifecycle */

async function refresh(): Promise<void> {
  const mine = ++epoch;
  const hostNow = normalizeHost(window.location.hostname);
  if (!hostNow || isDenylisted(hostNow)) {
    stop();
    clearPendingMarks();
    restoreAllTracked(true);
    return;
  }
  if (hostNow !== pageHost) {
    restoreAllTracked(true);
    recentPicks = [];
    pageHost = hostNow;
    adapter = adapterForHost(pageHost);
  }

  const state = await send<EngineState>({ type: 'getState' });
  if (mine !== epoch) return;
  clearPendingMarks();
  if (state === null || state.denied || !state.allowed || state.enabledRules === 0) {
    stop();
    restoreAllTracked(true);
    return;
  }
  start();
}

/**
 * US-014: after the library changes, existing cards redraw from the new pile;
 * an emptied library turns them back into compact collapse cards.
 */
async function repickTracked(): Promise<void> {
  const entries = [...tracked.entries()];
  for (const [post, entry] of entries) {
    const { media, assetId } = await resolveMedia(`${entry.sig}\u0000${entry.ruleId}`, false);
    if (!tracked.has(post)) continue;
    entry.assetId = assetId;
    entry.view.setMedia(media);
    if (assetId === null) {
      entry.view.setReducedMotion(reducedMotion);
    }
  }
}

async function applyMotionChange(): Promise<void> {
  for (const entry of tracked.values()) {
    entry.view.setReducedMotion(reducedMotion);
    if (entry.assetId === null) continue;
    const resolved = mediaUrls.get(entry.assetId);
    if (resolved === undefined) continue;
    const media = await mediaVariant(resolved);
    entry.view.setMedia(media);
  }
}

function isSettingsChanged(message: unknown): boolean {
  const type = message !== null && typeof message === 'object'
    ? (message as { type?: unknown }).type
    : null;
  return type === 'settingsChanged';
}

function isMediaChanged(message: unknown): boolean {
  const type = message !== null && typeof message === 'object'
    ? (message as { type?: unknown }).type
    : null;
  return type === 'mediaChanged';
}

/* ---------------------------------------------------------------------- init */

if (pageHost !== '' && !isDenylisted(pageHost)) {
  // QA-visible injection marker; no data, no behavior.
  document.documentElement.setAttribute('data-polymorph-extension', '1');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = motionQuery.matches;
  motionQuery.addEventListener('change', (event) => {
    reducedMotion = event.matches;
    void applyMotionChange();
  });
  window.addEventListener('popstate', () => void refresh());
  window.addEventListener('hashchange', () => void refresh());
  chrome.runtime.onMessage.addListener((message) => {
    if (isSettingsChanged(message)) void refresh();
    if (isMediaChanged(message)) void repickTracked();
  });
  void refresh();
}