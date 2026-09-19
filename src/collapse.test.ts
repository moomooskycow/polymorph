import { describe, expect, it } from 'vitest';
import { buildBar, collapsePost, isProcessed, postState, restorePost } from './collapse';

function makePost(): HTMLElement {
  document.body.innerHTML = '<article id="post"><p>Some post text long enough to count.</p></article>';
  const post = document.getElementById('post');
  if (!(post instanceof HTMLElement)) throw new Error('fixture missing');
  return post;
}

function shadowOf(bar: HTMLElement): ShadowRoot {
  const shadow = bar.shadowRoot;
  if (shadow === null) throw new Error('bar has no shadow root');
  return shadow;
}

function barFor(face: 'collapse' | 'kitten' | 'meme'): HTMLElement {
  return buildBar({ ruleId: 'rage-bait', ruleName: 'Rage bait', face }).bar;
}

describe('US-002 collapse bar', () => {
  it('US-002 collapses a post to a one-line shadow-DOM bar naming the rule', () => {
    const post = makePost();
    const bar = collapsePost(post, { ruleId: 'rage-bait', ruleName: 'Rage bait', face: 'collapse' });
    expect(bar).not.toBeNull();
    expect(post.style.display).toBe('none');
    expect(post.previousElementSibling).toBe(bar);
    const shadow = shadowOf(bar!);
    expect(shadow.textContent).toContain('Rage bait');
    expect(shadow.querySelector('button')?.textContent).toBe('Restore');
    expect(postState(post)).toBe('collapsed');
    expect(isProcessed(post)).toBe(true);
  });

  it('US-002 restore brings the post back in place and blocks re-collapse', () => {
    const post = makePost();
    post.style.display = 'flex';
    const bar = collapsePost(post, { ruleId: 'rage-bait', ruleName: 'Rage bait', face: 'collapse' })!;
    shadowOf(bar).querySelector('button')?.click();
    expect(document.querySelector('polymorph-collapse')).toBeNull();
    expect(post.style.display).toBe('flex');
    expect(post.isConnected).toBe(true);
    expect(postState(post)).toBe('restored');
    // A re-scan sees the marker and must not queue this post again.
    expect(isProcessed(post)).toBe(true);
  });

  it('US-002 direct restore is idempotent about the original display', () => {
    const post = makePost();
    const bar = collapsePost(post, { ruleId: 'x', ruleName: 'X', face: 'collapse' })!;
    restorePost(post, bar);
    expect(post.style.display).toBe('');
    expect(postState(post)).toBe('restored');
  });
});

describe('US-003 faces on the collapsed bar', () => {
  it('US-003 kitten and meme faces draw a bundled inline SVG, never a URL', () => {
    for (const face of ['kitten', 'meme'] as const) {
      const shadow = shadowOf(barFor(face));
      expect(shadow.querySelector('svg'), face).not.toBeNull();
      expect(shadow.querySelector('img'), face).toBeNull();
      const markup = shadow.innerHTML.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
      expect(markup, face).not.toContain('http');
    }
  });

  it('US-003 the collapse face draws the rule name and restore control only', () => {
    const shadow = shadowOf(barFor('collapse'));
    expect(shadow.querySelector('svg')).toBeNull();
    expect(shadow.querySelector('img')).toBeNull();
    expect(shadow.textContent).toContain('Rage bait');
    expect(shadow.querySelector('button')?.textContent).toBe('Restore');
  });
});