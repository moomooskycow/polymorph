import { afterEach, describe, expect, it, vi } from 'vitest';

const ARTICLE = 'A fixture post body that is comfortably longer than forty characters.';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const baseState = {
  host: 'x.com',
  masterEnabled: true,
  allowed: true,
  denied: false,
  enabledRules: 1,
  keyPresent: true,
};

const collapseDecision = {
  verdict: 'collapse',
  ruleId: 'rage-bait',
  ruleName: 'Rage bait',
  probability: 0.95,
  confidence: 0.9,
};

const mediaReply = {
  ok: true,
  empty: false,
  id: 'asset-1',
  kind: 'png',
  mime: 'image/png',
  size: 68,
  width: 1,
  height: 1,
  base64: PNG_BASE64,
};

function setUrl(url: string): void {
  const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
  happyDOM.setURL(url);
}

interface Stub {
  sendMessage: ReturnType<typeof vi.fn>;
  listeners: Array<(message: unknown) => void>;
  setAllowed(allowed: boolean): void;
  setMedia(reply: unknown): void;
}

let activeStubs: Stub[] = [];
const originalMatchMedia = window.matchMedia.bind(window);

function stubChrome(decisions: unknown[]): Stub {
  let allowed = true;
  let media: unknown = { ok: true, empty: true };
  const listeners: Array<(message: unknown) => void> = [];
  const sendMessage = vi.fn(async (message: { type?: string }) => {
    if (message?.type === 'getState') return { ...baseState, allowed };
    if (message?.type === 'classify') {
      return decisions.length > 0
        ? decisions.shift()
        : { verdict: 'leave', reason: 'no_rule_matched' };
    }
    if (message?.type === 'media:pick') return media;
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: (listener: (message: unknown) => void) => listeners.push(listener) },
      getManifest: () => ({ version: '0.3.0' }),
      getURL: (path: string) => path,
      openOptionsPage: vi.fn(),
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => []), create: vi.fn() },
  });
  const stub: Stub = {
    sendMessage,
    listeners,
    setAllowed: (next) => {
      allowed = next;
    },
    setMedia: (reply) => {
      media = reply;
    },
  };
  activeStubs.push(stub);
  return stub;
}

afterEach(async () => {
  for (const stub of activeStubs) {
    stub.setAllowed(false);
    for (const listener of stub.listeners) listener({ type: 'settingsChanged' });
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
  activeStubs = [];
  window.matchMedia = originalMatchMedia;
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('US-004 content denylist gate', () => {
  it('US-004 reads no posts and sends nothing on a denylisted host', async () => {
    setUrl('https://mail.google.com/mail/u/0/');
    document.body.innerHTML = `<article data-testid="tweet">${ARTICLE}</article>`;
    const stub = stubChrome([collapseDecision]);
    await import('./content');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(stub.sendMessage).not.toHaveBeenCalled();
  });
});

describe('US-010 content transform lifecycle', () => {
  it('US-010 an added post collapses compactly when the library is empty, and restores', async () => {
    setUrl('https://x.com/home');
    document.body.innerHTML = '<div id="feed"></div>';
    const stub = stubChrome([collapseDecision]);
    await import('./content');
    await vi.waitFor(() => expect(stub.sendMessage).toHaveBeenCalledWith({ type: 'getState' }));
    expect(document.documentElement.hasAttribute('data-polymorph-extension')).toBe(true);

    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.textContent = ARTICLE;
    document.getElementById('feed')?.append(article);

    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).not.toBeNull(), {
      timeout: 2_000,
    });
    const card = document.querySelector('polymorph-card');
    expect(card?.shadowRoot?.querySelector('img')).toBeNull();
    expect(card?.shadowRoot?.querySelector('.card')?.classList.contains('plain')).toBe(true);
    expect(article.style.display).toBe('none');
    expect(article.getAttribute('data-polymorph-state')).toBe('transformed');

    card?.shadowRoot?.querySelector('button')?.click();
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).toBeNull());
    expect(article.style.display).toBe('');
    expect(article.getAttribute('data-polymorph-state')).toBe('restored');

    const classifyCalls = stub.sendMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === 'classify',
    );
    expect(classifyCalls.length).toBe(1);
  });

  it('US-014 a library asset renders as a local blob image and stays stable per post', async () => {
    setUrl('https://x.com/home');
    document.body.innerHTML = `<div id="feed"><article data-testid="tweet">${ARTICLE}</article></div>`;
    const stub = stubChrome([collapseDecision]);
    stub.setMedia(mediaReply);
    await import('./content');
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).not.toBeNull(), {
      timeout: 2_000,
    });

    const img = document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')?.startsWith('blob:')).toBe(true);
    expect(img?.getAttribute('data-media-mime')).toBe('image/png');
    const src = img?.getAttribute('src');

    // Same text, fresh mutation: no re-evaluation and no flicker.
    const article = document.querySelector('article');
    if (article !== null) article.textContent = ARTICLE;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const classifyCalls = stub.sendMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === 'classify',
    );
    expect(classifyCalls.length).toBe(1);
    expect(
      document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img')?.getAttribute('src'),
    ).toBe(src);
  });

  it('US-008 recycled content on a transformed node is restored and re-judged', async () => {
    setUrl('https://x.com/home');
    document.body.innerHTML = `<div id="feed"><article data-testid="tweet">${ARTICLE}</article></div>`;
    const stub = stubChrome([collapseDecision, { verdict: 'leave', reason: 'no_rule_matched' }]);
    stub.setMedia(mediaReply);
    await import('./content');
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).not.toBeNull(), {
      timeout: 2_000,
    });

    const article = document.querySelector('article');
    if (article === null) throw new Error('fixture missing');
    article.textContent =
      'A recycled post with completely different words that is still long enough.';
    await vi.waitFor(
      () =>
        expect(stub.sendMessage).toHaveBeenCalledWith({
          type: 'classify',
          text: 'A recycled post with completely different words that is still long enough.',
        }),
      { timeout: 2_000 },
    );
    await vi.waitFor(() => expect(article.style.display).toBe(''), { timeout: 2_000 });
    await vi.waitFor(() => expect(article.getAttribute('data-polymorph-state')).toBe('left'));
    expect(document.querySelector('polymorph-card')).toBeNull();
  });
});

describe('US-014 media library changes reach open pages', () => {
  it('US-014 adding media redraws a collapse card, and emptying the pile collapses again', async () => {
    setUrl('https://x.com/home');
    document.body.innerHTML = `<div id="feed"><article data-testid="tweet">${ARTICLE}</article></div>`;
    const stub = stubChrome([collapseDecision]);
    await import('./content');
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).not.toBeNull(), {
      timeout: 2_000,
    });
    expect(document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img')).toBeNull();

    stub.setMedia(mediaReply);
    for (const listener of stub.listeners) listener({ type: 'mediaChanged' });
    await vi.waitFor(
      () =>
        expect(
          document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img'),
        ).not.toBeNull(),
      { timeout: 2_000 },
    );

    stub.setMedia({ ok: true, empty: true });
    for (const listener of stub.listeners) listener({ type: 'mediaChanged' });
    await vi.waitFor(
      () =>
        expect(
          document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img'),
        ).toBeNull(),
      { timeout: 2_000 },
    );
  });
});

describe('US-009 reduced motion with animated GIFs', () => {
  it('US-009 a GIF never animates under reduced motion: only a frozen frame or collapse', async () => {
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    setUrl('https://x.com/home');
    document.body.innerHTML = `<div id="feed"><article data-testid="tweet">${ARTICLE}</article></div>`;
    const stub = stubChrome([collapseDecision]);
    stub.setMedia({
      ...mediaReply,
      kind: 'gif',
      mime: 'image/gif',
    });
    await import('./content');
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).not.toBeNull(), {
      timeout: 2_000,
    });

    const img =
      document.querySelector('polymorph-card')?.shadowRoot?.querySelector('img') ?? null;
    if (img !== null) {
      // If a frame was produced it must be the frozen still, never the GIF.
      expect(img.getAttribute('data-media-frozen')).toBe('true');
      expect(img.getAttribute('data-media-mime')).toBe('image/png');
    }
    const animatedGif = document.querySelector(
      'polymorph-card img[data-media-mime="image/gif"]',
    );
    expect(animatedGif).toBeNull();
  });
});