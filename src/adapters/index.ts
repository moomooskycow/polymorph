import { MIN_POST_CHARS } from '../defaults';
import { normalizeHost } from '../hosts';
import { genericAdapter } from './generic';
import { hnAdapter } from './hn';
import { redditAdapter } from './reddit';
import { xAdapter } from './x';
import { youtubeAdapter } from './youtube';

export type AdapterId = 'x' | 'reddit' | 'hn' | 'youtube' | 'generic';

export interface Adapter {
  id: AdapterId;
  /** Selectors that define "a post" on this site. */
  selectors: readonly string[];
  /** Subtrees that are never posts even if a selector matches inside them. */
  skip?: readonly string[];
}

export const ADAPTERS: Record<AdapterId, Adapter> = {
  x: xAdapter,
  reddit: redditAdapter,
  hn: hnAdapter,
  youtube: youtubeAdapter,
  generic: genericAdapter,
};

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function adapterForHost(input: string | null | undefined): Adapter {
  const host = normalizeHost(input);
  if (!host) return genericAdapter;
  if (hostMatches(host, 'x.com') || hostMatches(host, 'twitter.com')) return xAdapter;
  if (hostMatches(host, 'reddit.com')) return redditAdapter;
  if (host === 'news.ycombinator.com') return hnAdapter;
  if (hostMatches(host, 'youtube.com')) return youtubeAdapter;
  return genericAdapter;
}

/** Visible text, whitespace-collapsed. Adapters only ever use `innerText`. */
export function visibleText(el: Element): string {
  const innerText = (el as HTMLElement).innerText;
  const raw = typeof innerText === 'string' ? innerText : (el.textContent ?? '');
  return raw.replace(/\s+/g, ' ').trim();
}

export function isLongEnough(el: Element): boolean {
  return visibleText(el).length >= MIN_POST_CHARS;
}

function isSkipped(el: Element, adapter: Adapter): boolean {
  return adapter.skip?.some((selector) => el.closest(selector) !== null) ?? false;
}

function pruneNested(nodes: HTMLElement[]): HTMLElement[] {
  return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
}

export function isPostElement(el: Element, adapter: Adapter): boolean {
  return adapter.selectors.some((selector) => el.matches(selector));
}

function isEligiblePost(el: Element, adapter: Adapter): boolean {
  return !isSkipped(el, adapter) && isLongEnough(el);
}

/** Nearest post ancestor (or self) for an incremental mutation target. */
export function closestPost(node: Node, adapter: Adapter): HTMLElement | null {
  const start = node instanceof Element ? node : node.parentElement;
  if (start === null) return null;
  const match = start.closest(adapter.selectors.join(','));
  return match instanceof HTMLElement && isEligiblePost(match, adapter) ? match : null;
}

/**
 * US-010 incremental scans: collect posts inside one changed subtree, plus the
 * subtree itself when it is a post. Avoids full-document queries on scroll.
 */
export function collectPostsIn(root: Element | Document, adapter: Adapter): HTMLElement[] {
  const found = new Set<HTMLElement>();
  if (root instanceof HTMLElement && isPostElement(root, adapter) && isEligiblePost(root, adapter)) {
    found.add(root);
  }
  for (const selector of adapter.selectors) {
    for (const el of root.querySelectorAll(selector)) {
      if (!(el instanceof HTMLElement)) continue;
      if (isSkipped(el, adapter)) continue;
      if (!isLongEnough(el)) continue;
      found.add(el);
    }
  }
  return pruneNested([...found]);
}

/**
 * US-002: what counts as a post is adapter-owned. Nodes under 40 visible
 * characters are dropped here so they never reach Jev.
 */
export function collectPosts(root: ParentNode, adapter: Adapter): HTMLElement[] {
  return collectPostsIn(root as Element | Document, adapter);
}