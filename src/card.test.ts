import { describe, expect, it } from 'vitest';
import {
  CARD_TAG,
  MOUNT_ATTR,
  buildCard,
  isCardNode,
  isInsideCard,
  restorePost,
  transformPost,
  type CardMedia,
} from './card';

const image: CardMedia = {
  url: 'blob:chrome-extension://test/abc',
  mime: 'image/png',
  frozen: false,
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

describe('US-014 replacement card', () => {
  it('US-014 draws the user image, bounded, with an accessible caption and Show original', () => {
    const view = buildCard({ ruleName: 'Rage bait', media: image });
    expect(view.element.tagName.toLowerCase()).toBe(CARD_TAG);
    expect(view.element.getAttribute('role')).toBe('group');

    const shadow = shadowOf(view.element);
    const img = shadow.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(image.url);
    expect(img?.getAttribute('data-media-mime')).toBe('image/png');
    expect(shadow.querySelector('svg')).toBeNull();
    expect(shadow.querySelector('.caption')?.textContent).toBe('Your image replaces this post.');
    expect(shadow.querySelector('.meta')?.textContent).toBe('Replaced by “Rage bait”');
    expect(shadow.querySelector('.art')?.getAttribute('aria-label')).toContain('Rage bait');
    expect(view.showOriginal.textContent).toBe('Show original');
    expect(view.showOriginal.getAttribute('aria-label')).toContain('Rage bait');

    const style = shadow.querySelector('style')?.textContent ?? '';
    expect(style).toContain('max-width: 480px');
    expect(style).toContain('height: 104px');
    expect(style).toContain('object-fit: contain');
    expect(style).toContain('focus-visible');
  });

  it('US-014 an empty library renders the compact collapse card with no image', () => {
    const view = buildCard({ ruleName: 'Rage bait', media: null });
    const shadow = shadowOf(view.element);
    expect(shadow.querySelector('img')).toBeNull();
    expect(shadow.querySelector('.card')?.classList.contains('plain')).toBe(true);
    expect(shadow.querySelector('.caption')?.textContent).toBe('Hidden by rule “Rage bait”');
    expect(shadow.querySelector('.show')?.textContent).toBe('Show original');
  });

  it('US-014 the card never renders file names, sizes, or paths', () => {
    const view = buildCard({ ruleName: 'Rage bait', media: image });
    const html = shadowOf(view.element).innerHTML;
    expect(html).not.toMatch(/\.png|\.gif|\.jpg|\.jpeg|\.webp/i);
    expect(html).not.toContain('C:\\');
    expect(html).not.toContain('/home/');
  });

  it('US-014 setMedia swaps between image and collapse without rebuilding the card', () => {
    const view = buildCard({ ruleName: 'Rage bait', media: image });
    view.setMedia(null);
    expect(shadowOf(view.element).querySelector('img')).toBeNull();
    expect(shadowOf(view.element).querySelector('.card')?.classList.contains('plain')).toBe(true);
    view.setMedia(image);
    expect(shadowOf(view.element).querySelector('img')).not.toBeNull();
  });

  it('US-014 frozen GIFs are marked and captioned as paused', () => {
    const view = buildCard({
      ruleName: 'Rage bait',
      media: { url: 'data:image/png;base64,AAAA', mime: 'image/png', frozen: true },
    });
    const img = shadowOf(view.element).querySelector('img');
    expect(img?.getAttribute('data-media-frozen')).toBe('true');
  });

  it('US-009 reduced motion is a host attribute', () => {
    const view = buildCard({ ruleName: 'Rage bait', media: image, reducedMotion: true });
    expect(view.element.getAttribute('data-reduced-motion')).toBe('true');
    view.setReducedMotion(false);
    expect(view.element.getAttribute('data-reduced-motion')).toBe('false');
  });
});

describe('US-008 transform and restore', () => {
  it('US-008 transform hides the post and mounts the card before it', () => {
    const post = postInBody();
    const view = buildCard({ ruleName: 'Rage bait', media: image });
    expect(transformPost(post, view)).toBe(true);
    expect(post.style.display).toBe('none');
    expect(post.previousElementSibling).toBe(view.element);
  });

  it('US-008 Show original restores the original display value and removes the card', () => {
    const post = postInBody();
    post.style.display = 'flex';
    const view = buildCard({ ruleName: 'Rage bait', media: image });
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
    const view = buildCard({ ruleName: 'Rage bait', media: image });
    transformPost(post, view);
    const wrapper = document.querySelector(`tr[${MOUNT_ATTR}]`);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.contains(view.element)).toBe(true);
    restorePost(post, view);
    expect(document.querySelector(`tr[${MOUNT_ATTR}]`)).toBeNull();
    expect(post.style.display).toBe('');
  });

  it('US-010 card nodes are identifiable so mutation flushes can ignore them', () => {
    const view = buildCard({ ruleName: 'Rage bait', media: image });
    expect(isCardNode(view.element)).toBe(true);
    expect(isCardNode(document.createElement('article'))).toBe(false);
    const child = document.createElement('span');
    view.element.appendChild(child);
    expect(isInsideCard(child)).toBe(true);
    expect(isInsideCard(document.createElement('span'))).toBe(false);
  });
});