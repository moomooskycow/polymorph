/**
 * US-010 signature marking. Nodes carry `data-polymorph-state` plus
 * `data-polymorph-sig`, a hash of normalized visible text. Same text means no
 * re-evaluation; changed text (recycled/edited DOM node) means re-evaluate.
 */
export type MarkState = 'pending' | 'left' | 'transformed' | 'restored' | 'deferred';

export const STATE_ATTR = 'data-polymorph-state';
export const SIG_ATTR = 'data-polymorph-sig';
/** Hash of the DOM text content, for change detection on hidden (transformed) nodes. */
export const CONTENT_SIG_ATTR = 'data-polymorph-content-sig';
/** v1 marker; cleared on sight so pre-upgrade markings cannot stick. */
export const LEGACY_ATTR = 'data-polymorph';

export interface PostMark {
  state: MarkState;
  sig: string;
  /**
   * Present on `transformed` nodes. `innerText` is empty while we hide the
   * post, so recycle detection compares this DOM-text hash instead.
   */
  contentSig?: string;
}

export function normalizeSignatureText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Two FNV-1a passes plus the text length. Pure and cheap enough for a
 * MutationObserver flush; stable across re-renders of identical text.
 */
export function postSignature(text: string): string {
  const normalized = normalizeSignatureText(text);
  const first = fnv1a(normalized, 0x811c9dc5);
  const second = fnv1a(`${first}:${normalized}`, 0x01000193);
  return `${first.toString(36)}${second.toString(36)}:${normalized.length}`;
}

export function readMark(el: Element): PostMark | null {
  const state = el.getAttribute(STATE_ATTR);
  const sig = el.getAttribute(SIG_ATTR);
  if (state === null || sig === null) return null;
  const contentSig = el.getAttribute(CONTENT_SIG_ATTR);
  return {
    state: state as MarkState,
    sig,
    ...(contentSig === null ? {} : { contentSig }),
  };
}

export function markPost(el: Element, state: MarkState, sig: string, contentSig?: string): void {
  el.setAttribute(STATE_ATTR, state);
  el.setAttribute(SIG_ATTR, sig);
  if (contentSig === undefined) el.removeAttribute(CONTENT_SIG_ATTR);
  else el.setAttribute(CONTENT_SIG_ATTR, contentSig);
  el.removeAttribute(LEGACY_ATTR);
}

export function clearMark(el: Element): void {
  el.removeAttribute(STATE_ATTR);
  el.removeAttribute(SIG_ATTR);
  el.removeAttribute(CONTENT_SIG_ATTR);
  el.removeAttribute(LEGACY_ATTR);
}

/**
 * True when this node needs work: unmarked, or its visible text changed.
 * `pending`, `left`, `transformed`, `restored`, and `deferred` with the same
 * signature are all "already handled for this content".
 */
export function shouldEvaluate(el: Element, sig: string): boolean {
  const mark = readMark(el);
  return mark === null || mark.sig !== sig;
}

/** True when a previously transformed node was recycled with new content. */
export function isRecycled(el: Element, sig: string): boolean {
  const mark = readMark(el);
  return mark !== null && mark.sig !== sig && mark.state === 'transformed';
}