import { adapterForHost, collectPosts, visibleText } from './adapters';
import { collapsePost, isProcessed, markPost } from './collapse';
import { MIN_POST_CHARS } from './defaults';
import { isDenylisted, normalizeHost } from './hosts';
import type { Decision, EngineState } from './types';

/**
 * US-004: the denylist check runs before anything touches the DOM. On a
 * denylisted host this script registers no observer and reads no text.
 */
const host = normalizeHost(window.location.hostname);

type ClassifyReply = Decision | { error?: string };

async function send<T>(message: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

let epoch = 0;
let scanning = false;
let scanScheduled = false;
let observer: MutationObserver | null = null;

function scheduleScan(): void {
  if (scanScheduled || !scanning) return;
  scanScheduled = true;
  const run = () => {
    scanScheduled = false;
    if (scanning) scan();
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 1000 });
  } else {
    window.setTimeout(run, 100);
  }
}

function startScanning(): void {
  if (scanning) {
    scan();
    return;
  }
  scanning = true;
  observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
}

function stopScanning(): void {
  scanning = false;
  observer?.disconnect();
  observer = null;
}

function scan(): void {
  const adapter = adapterForHost(host);
  for (const post of collectPosts(document, adapter)) {
    if (isProcessed(post)) continue;
    const text = visibleText(post);
    if (text.length < MIN_POST_CHARS) {
      markPost(post, 'left');
      continue;
    }
    markPost(post, 'pending');
    void classify(post, text);
  }
}

async function classify(post: HTMLElement, text: string): Promise<void> {
  const reply = await send<ClassifyReply>({ type: 'classify', text });
  if (reply !== null && 'verdict' in reply && reply.verdict === 'collapse') {
    const bar = collapsePost(post, {
      ruleId: reply.ruleId,
      ruleName: reply.ruleName,
      face: reply.face,
    });
    if (bar !== null) {
      void send({ type: 'reportCollapse' });
      return;
    }
  }
  // US-006: errors, failures, and gate misses all leave the post visible.
  // Marking it stops the observer from re-queueing the same node.
  markPost(post, 'left');
}

async function refresh(): Promise<void> {
  const mine = ++epoch;
  if (!host || isDenylisted(host)) return;

  const state = await send<EngineState>({ type: 'getState' });
  if (mine !== epoch) return;
  if (state === null || !state.allowed || state.enabledRules === 0) {
    stopScanning();
    return;
  }
  startScanning();
}

function isSettingsChanged(message: unknown): boolean {
  return (
    message !== null &&
    typeof message === 'object' &&
    (message as { type?: unknown }).type === 'settingsChanged'
  );
}

if (host && !isDenylisted(host)) {
  chrome.runtime.onMessage.addListener((message) => {
    if (isSettingsChanged(message)) void refresh();
  });
  void refresh();
}