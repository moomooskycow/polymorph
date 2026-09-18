import { pickFaceSvg } from './faces';
import type { Face } from './types';

/** Custom element that hosts the shadow-DOM bar. */
export const BAR_TAG = 'polymorph-collapse';
/** Marker attribute on posts and bars; also the re-scan guard. */
export const MARK_ATTR = 'data-polymorph';

export type PostState = 'pending' | 'left' | 'collapsed' | 'restored';

export interface CollapseOptions {
  ruleId: string;
  ruleName: string;
  face: Face;
}

const BAR_STYLE = `
:host { display: block; margin: 6px 0; }
.bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  border: 1px solid currentColor;
  border-radius: 8px;
  font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
  color: #6b6862;
}
svg { width: 20px; height: 20px; flex: none; }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button {
  font: inherit; border: 1px solid currentColor; background: transparent;
  color: inherit; border-radius: 999px; padding: 2px 10px; cursor: pointer;
}
button:hover { background: rgba(127, 127, 127, 0.15); }
`;

/** US-003: parse a bundled SVG string into an element for inline rendering. */
export function svgElement(svgText: string): SVGElement | null {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root === null || root.tagName.toLowerCase() !== 'svg') return null;
  return document.importNode(root, true) as unknown as SVGElement;
}

export interface BarView {
  bar: HTMLElement;
  restoreButton: HTMLButtonElement;
}

/**
 * US-002: one-line bar naming the rule with a restore control. US-003: a
 * bundled face is drawn inline for `kitten` and `meme`; `collapse` stays plain.
 */
export function buildBar(options: CollapseOptions): BarView {
  const bar = document.createElement(BAR_TAG);
  bar.setAttribute(MARK_ATTR, 'bar');

  const shadow = bar.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BAR_STYLE;

  const row = document.createElement('div');
  row.className = 'bar';

  const svgText = pickFaceSvg(options.face, options.ruleId);
  if (svgText !== null) {
    const svg = svgElement(svgText);
    if (svg !== null) row.appendChild(svg);
  }

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = `Hidden by rule “${options.ruleName}”`;

  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'restore';
  restoreButton.textContent = 'Restore';

  row.append(label, restoreButton);
  shadow.append(style, row);
  return { bar, restoreButton };
}

export function markPost(post: HTMLElement, state: PostState): void {
  post.setAttribute(MARK_ATTR, state);
}

export function postState(post: Element): string | null {
  return post.getAttribute(MARK_ATTR);
}

/**
 * US-002: after restore the post must not re-collapse until a reload. Every
 * non-null marker (including `restored` and `left`) suppresses re-processing.
 */
export function isProcessed(post: Element): boolean {
  return postState(post) !== null;
}

const previousDisplay = new WeakMap<HTMLElement, string>();

/** Hides the post in place and inserts the bar before it. */
export function collapsePost(post: HTMLElement, options: CollapseOptions): HTMLElement | null {
  const parent = post.parentNode;
  if (parent === null) return null;

  const { bar, restoreButton } = buildBar(options);
  previousDisplay.set(post, post.style.display);
  post.style.display = 'none';
  parent.insertBefore(bar, post);
  markPost(post, 'collapsed');
  restoreButton.addEventListener('click', () => {
    restorePost(post, bar);
  });
  return bar;
}

/** US-002: remove the bar and show the original post again. */
export function restorePost(post: HTMLElement, bar: HTMLElement): void {
  bar.remove();
  post.style.display = previousDisplay.get(post) ?? '';
  previousDisplay.delete(post);
  markPost(post, 'restored');
}