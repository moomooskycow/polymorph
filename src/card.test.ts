import { describe, expect, it } from 'vitest';
import {
  CARD_TAG,
  MOUNT_ATTR,
  buildCard,
  isCardNode,
  isInsideCard,
  restorePost,
  transformPost,
} from './card';
import type { ReplacementAsset } from './replacements/library';

const asset: ReplacementAsset = {
  id: 'cute-test',
  file: 'cute-test.svg',
  category: 'cute',
  caption: 'A test kitten.',
  motion: 'static',
  license: 'CC0-1.0 (authored for Polymorph)',
  author: 'test',
  created: '2026-09-19',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
};

const fallback: ReplacementAsset = {
  ...asset,
  id: 'cute-test-static',
  caption: 'A still test kitten.',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="8" height="8" x="1" y="1"/></svg>',
};

function shadowOf(element: HTMLElement): ShadowRoot {
  const shadow = element.shadowRoot;
  if (shadow === null) throw new Error('card has no shadow root');
  return shadow;
}

function postInBody(): HTMLElement {
  document.body.innerHTML = '<article id="post"><p>Original post body.</p></article>';
  const post = document.getElementById('post');
  if (!(post instanceof HTMLElement)) throw new Error('fixture missing');
  return post;
}

describe('US-008 replacement card', () => {
  it('US-008 draws bounded art, an accessible caption, and a Show original control', () => {
    const view = buildCard({ ruleName: 'Rage bait', asset });
    expect(view.element.tagName.toLowerCase()).toBe(CARD_TAG);
    expect(view.element.getAttribute('role')).toBe('group');
    expect(view.element.getAttribute('aria-label')).toContain('A test kitten.');

    const shadow = shadowOf(view.element);
    expect(shadow.querySelector('svg')).not.toBeNull();
    expect(shadow.querySelector('.art')?.getAttribute('aria-label')).toBe('A test kitten.');
    expect(shadow.querySelector('.caption')?.textContent).toBe('A test kitten.');
    expect(shadow.querySelector('.meta')?.textContent).toBe('Replaced by “Rage bait”');
    expect(view.showOriginal.tagName).toBe('BUTTON');
    expect(view.showOriginal.textContent).toBe('Show original');
    expect(view.showOriginal.getAttribute('aria-label')).toContain('Rage bait');

    const style = shadow.querySelector('style')?.textContent ?? '';
    expect(style).toContain('max-width: 480px');
    expect(style).toContain('height: 104px');
    expect(style).toContain('focus-visible');
    expect(style).toContain('data-reduced-motion');
  });

  it('US-008 the collapse mix draws a compact one-line card with no art', () => {
    const view = buildCard({ ruleName: 'Rage bait', asset: null });
    const shadow = shadowOf(view.element);
    expect(shadow.querySelector('svg')).toBeNull();
    expect(shadow.querySelector('.card')?.classList.contains('plain')).toBe(true);
    expect(shadow.querySelector('.caption')?.textContent).toBe('Hidden by rule “Rage bait”');
    expect(shadow.querySelector('.show')?.textContent).toBe('Show original');
  });

  it('US-008 setAsset swaps art and captions without rebuilding the card', () => {
    const view = buildCard({ ruleName: 'Rage bait', asset });
    view.setAsset(fallback);
    const shadow = shadowOf(view.element);
    expect(shadow.querySelector('.caption')?.textContent).toBe('A still test kitten.');
    expect(shadow.querySelector('.art')?.getAttribute('aria-label')).toBe('A still test kitten.');
    view.setAsset(null);
    expect(shadow.querySelector('svg')).toBeNull();
    expect(shadow.querySelector('.card')?.classList.contains('plain')).toBe(true);
  });

  it('US-009 reduced motion is a host attribute the CSS can freeze on', () => {
    const view = buildCard({ ruleName: 'Rage bait', asset, reducedMotion: true });
    expect(view.element.getAttribute('data-reduced-motion')).toBe('true');
    view.setReducedMotion(false);
    expect(view.element.getAttribute('data-reduced-motion')).toBe('false');
  });
});

describe('US-008 transform and restore', () => {
  it('US-008 transform hides the post and mounts the card before it', () => {
    const post = postInBody();
    const view = buildCard({ ruleName: 'Rage bait', asset });
    expect(transformPost(post, view)).toBe(true);
    expect(post.style.display).toBe('none');
    expect(post.previousElementSibling).toBe(view.element);
  });

  it('US-008 Show original restores the original display value and removes the card', () => {
    const post = postInBody();
    post.style.display = 'flex';
    const view = buildCard({ ruleName: 'Rage bait', asset });
    transformPost(post, view);
    view.showOriginal.addEventListener('click', () => restorePost(post, view));
    view.showOriginal.click();
    expect(post.style.display).toBe('flex');
    expect(post.isConnected).toBe(true);
    expect(document.querySelector(CARD_TAG)).toBeNull();
  });

  it('US-008 table-row posts (HN) mount inside a row wrapper that restore removes', () => {
    document.body.innerHTML =
      '<table><tbody><tr class="athing" id="row"><td>Title</td><td>meta</td></tr></tbody></table>';
    const post = document.getElementById('row');
    if (!(post instanceof HTMLElement)) throw new Error('fixture missing');
    const view = buildCard({ ruleName: 'Rage bait', asset });
    transformPost(post, view);
    const wrapper = document.querySelector(`tr[${MOUNT_ATTR}]`);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.contains(view.element)).toBe(true);
    restorePost(post, view);
    expect(document.querySelector(`tr[${MOUNT_ATTR}]`)).toBeNull();
    expect(post.style.display).toBe('');
  });

  it('US-010 card nodes are identifiable so mutation flushes can ignore them', () => {
    const view = buildCard({ ruleName: 'Rage bait', asset });
    expect(isCardNode(view.element)).toBe(true);
    expect(isCardNode(document.createElement('article'))).toBe(false);
    const child = document.createElement('span');
    view.element.appendChild(child);
    expect(isInsideCard(child)).toBe(true);
    expect(isInsideCard(document.createElement('span'))).toBe(false);
  });
});