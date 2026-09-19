import { afterEach, describe, expect, it, vi } from 'vitest';

const ARTICLE = 'A fixture post body that is comfortably longer than forty characters.';

const baseState = {
  host: 'x.com',
  masterEnabled: true,
  allowed: true,
  denied: false,
  enabledRules: 1,
  keyPresent: true,
  replacementMix: 'mixed',
};

const collapseDecision = {
  verdict: 'collapse',
  ruleId: 'rage-bait',
  ruleName: 'Rage bait',
  face: 'inherit',
  probability: 0.95,
  confidence: 0.9,
};

function setUrl(url: string): void {
  const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
  happyDOM.setURL(url);
}

interface Stub {
  sendMessage: ReturnType<typeof vi.fn>;
  listeners: Array<(message: unknown) => void>;
  setAllowed(allowed: boolean): void;
}

let activeStubs: Stub[] = [];

function stubChrome(decisions: unknown[]): Stub {
  let allowed = true;
  const listeners: Array<(message: unknown) => void> = [];
  const sendMessage = vi.fn(async (message: { type?: string }) => {
    if (message?.type === 'getState') return { ...baseState, allowed };
    if (message?.type === 'classify') {
      return decisions.length > 0
        ? decisions.shift()
        : { verdict: 'leave', reason: 'no_rule_matched' };
    }
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: (listener: (message: unknown) => void) => listeners.push(listener) },
      getManifest: () => ({ version: '0.2.0' }),
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
    setAllowed: (next: boolean) => {
      allowed = next;
    },
  };
  activeStubs.push(stub);
  return stub;
}

afterEach(async () => {
  // Disable every content module from this file so its observer disconnects
  // before the next test touches the shared happy-dom document.
  for (const stub of activeStubs) {
    stub.setAllowed(false);
    for (const listener of stub.listeners) listener({ type: 'settingsChanged' });
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
  activeStubs = [];
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
  it('US-010 an added post is classified, transformed, and restored from the card', async () => {
    setUrl('https://x.com/home');
    document.body.innerHTML = '<div id="feed"></div>';
    const stub = stubChrome([collapseDecision]);
    await import('./content');
    await vi.waitFor(() => expect(stub.sendMessage).toHaveBeenCalledWith({ type: 'getState' }));

    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.textContent = ARTICLE;
    document.getElementById('feed')?.append(article);

    await vi.waitFor(
      () => expect(stub.sendMessage).toHaveBeenCalledWith({ type: 'classify', text: ARTICLE }),
      { timeout: 2_000 },
    );
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).not.toBeNull(), {
      timeout: 2_000,
    });
    expect(article.style.display).toBe('none');
    expect(article.getAttribute('data-polymorph-state')).toBe('transformed');
    expect(article.getAttribute('data-polymorph-content-sig')).not.toBeNull();

    const card = document.querySelector('polymorph-card');
    card?.shadowRoot?.querySelector('button')?.click();
    await vi.waitFor(() => expect(document.querySelector('polymorph-card')).toBeNull());
    expect(article.style.display).toBe('');
    expect(article.getAttribute('data-polymorph-state')).toBe('restored');

    // Same content must not be classified again after a manual restore.
    const classifyCalls = stub.sendMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === 'classify',
    );
    expect(classifyCalls.length).toBe(1);
  });

  it('US-008 recycled content on a transformed node is restored and re-judged', async () => {
    setUrl('https://x.com/home');
    document.body.innerHTML = `<div id="feed"><article data-testid="tweet">${ARTICLE}</article></div>`;
    const stub = stubChrome([collapseDecision, { verdict: 'leave', reason: 'no_rule_matched' }]);
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