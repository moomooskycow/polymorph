import { describe, expect, it } from 'vitest';
import {
  LEGACY_ATTR,
  SIG_ATTR,
  STATE_ATTR,
  clearMark,
  isRecycled,
  markPost,
  postSignature,
  readMark,
  shouldEvaluate,
} from './marking';

describe('US-010 signature marking', () => {
  it('US-010 normalizes whitespace so re-renders keep the same signature', () => {
    expect(postSignature('  one\n two   three ')).toBe(postSignature('one two three'));
  });

  it('US-010 changed visible text produces a new signature', () => {
    expect(postSignature('the original post')).not.toBe(postSignature('a recycled post'));
    expect(postSignature('post one')).not.toBe(postSignature('post two'));
  });

  it('US-010 unmarked nodes evaluate; same-signature nodes do not', () => {
    const post = document.createElement('article');
    const sig = postSignature('some text');
    expect(shouldEvaluate(post, sig)).toBe(true);
    for (const state of ['pending', 'left', 'transformed', 'restored', 'deferred'] as const) {
      markPost(post, state, sig);
      expect(shouldEvaluate(post, sig), state).toBe(false);
    }
  });

  it('US-010 a recycled transformed node is detected when its text changes', () => {
    const post = document.createElement('article');
    const oldSig = postSignature('old content');
    const newSig = postSignature('new content');
    markPost(post, 'transformed', oldSig);
    expect(isRecycled(post, newSig)).toBe(true);
    expect(isRecycled(post, oldSig)).toBe(false);
    expect(shouldEvaluate(post, newSig)).toBe(true);
    markPost(post, 'left', oldSig);
    expect(isRecycled(post, newSig)).toBe(false);
  });

  it('US-010 marks round-trip and clear removes every marker including the v1 attr', () => {
    const post = document.createElement('article');
    post.setAttribute(LEGACY_ATTR, 'collapsed');
    markPost(post, 'left', 'abc:3');
    expect(readMark(post)).toEqual({ state: 'left', sig: 'abc:3' });
    markPost(post, 'transformed', 'abc:3', 'dom:3');
    expect(readMark(post)).toEqual({ state: 'transformed', sig: 'abc:3', contentSig: 'dom:3' });
    expect(post.getAttribute(STATE_ATTR)).toBe('transformed');
    expect(post.getAttribute(SIG_ATTR)).toBe('abc:3');
    expect(post.hasAttribute(LEGACY_ATTR)).toBe(false);
    clearMark(post);
    expect(readMark(post)).toBeNull();
    expect(post.hasAttribute('data-polymorph-content-sig')).toBe(false);
  });
});