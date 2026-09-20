import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsSnapshot } from '../diagnostics';
import { emptyUsage, MEDIA_EMPTY_COPY, type MediaAssetMeta } from '../media/types';

const snapshot: DiagnosticsSnapshot = {
  version: '0.3.0',
  generatedAt: Date.now(),
  paused: false,
  pausedForMs: 0,
  activeRules: ['Rage bait'],
  totals: {
    discovered: 0,
    queued: 0,
    evaluated: 0,
    transformed: 4,
    skipped: 2,
    errors: 0,
    restored: 0,
  },
  currentSite: { host: 'x.com', allowed: true, denied: false, masterEnabled: true },
  tabs: [],
  recent: [],
};

const asset: MediaAssetMeta = {
  id: 'asset-1',
  kind: 'png',
  mime: 'image/png',
  size: 12_288,
  addedAt: 1,
  width: 16,
  height: 16,
  thumb: 'data:image/webp;base64,AAAA',
};

interface StubState {
  assets: MediaAssetMeta[];
  removed: string[];
}

function stubChrome(): StubState {
  const state: StubState = { assets: [], removed: [] };
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string; id?: string }) => {
        switch (message?.type) {
          case 'hasKey':
            return { hasKey: false };
          case 'getDiagnostics':
            return snapshot;
          case 'testKey':
            return { ok: false, ms: 0, errorKind: 'no_key' };
          case 'media:list':
            return {
              ok: true,
              assets: state.assets,
              usage: { ...emptyUsage(), count: state.assets.length, totalBytes: state.assets.reduce((sum, item) => sum + item.size, 0) },
            };
          case 'media:remove':
            state.removed.push(message.id ?? '');
            state.assets = state.assets.filter((item) => item.id !== message.id);
            return { ok: true, removed: true, usage: emptyUsage() };
          default:
            return { ok: true };
        }
      }),
      onMessage: { addListener: vi.fn() },
      getManifest: () => ({ version: '0.3.0' }),
      openOptionsPage: vi.fn(),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
    tabs: { query: vi.fn(async () => []), create: vi.fn() },
  });
  return state;
}

function mount(): HTMLElement {
  document.body.innerHTML = '<main id="app"></main>';
  const root = document.getElementById('app');
  if (root === null) throw new Error('missing #app');
  return root;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('US-007 options explains enablement', () => {
  it('US-007 shows setup steps, labeled rule switches, and no mix chooser', async () => {
    stubChrome();
    const root = mount();
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Get set up — 3 steps'));

    expect(root.textContent).toContain('Turn on at least one rule');
    expect(root.textContent).toContain('Enable rule');
    expect(root.querySelectorAll('.chip').length).toBe(3);
    expect(root.querySelectorAll('input[name="replacement-mix"]').length).toBe(0);
    expect(root.textContent).toContain('Test connection');
    expect(root.querySelector('#diagnostics')).not.toBeNull();
  });
});

describe('US-014 options media library', () => {
  it('US-014 empty library shows the exact copy, usage line, and a chooser', async () => {
    stubChrome();
    const root = mount();
    await import('./main');
    await vi.waitFor(() => expect(root.querySelector('#media-input')).not.toBeNull());
    expect(root.textContent).toContain(MEDIA_EMPTY_COPY);
    expect(root.querySelector<HTMLElement>('.media-empty')?.hidden).toBe(false);
    expect(root.textContent).toContain('0 images · 0 B of 100 MB');
    const input = root.querySelector<HTMLInputElement>('#media-input');
    expect(input).not.toBeNull();
    expect(input?.multiple).toBe(true);
    expect(input?.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
    expect(root.querySelector('.media-grid')?.children.length).toBe(0);
  });

  it('US-014 assets render as labeled thumbnails and removal returns to the empty state', async () => {
    const state = stubChrome();
    state.assets = [asset];
    const root = mount();
    await import('./main');
    await vi.waitFor(() => expect(root.querySelector('.media-item')).not.toBeNull());

    expect(root.textContent).toContain('1 image · 12 KB of 100 MB');
    expect(root.querySelector<HTMLElement>('.media-empty')?.hidden).toBe(true);
    expect(root.querySelector('.media-item')?.getAttribute('data-media-id')).toBe('asset-1');
    expect(root.querySelector('.media-thumb img')?.getAttribute('src')).toBe(asset.thumb);
    expect(root.textContent).toContain('PNG · 12 KB');

    root.querySelector<HTMLButtonElement>('.media-remove')?.click();
    await vi.waitFor(() => expect(root.querySelector('.media-item')).toBeNull());
    expect(state.removed).toEqual(['asset-1']);
    expect(root.querySelector<HTMLElement>('.media-empty')?.hidden).toBe(false);
  });
});

describe('US-012 test connection', () => {
  it('US-012 reports no_key without a key and never echoes one', async () => {
    stubChrome();
    const root = mount();
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Test connection'));
    const button = [...root.querySelectorAll('button')].find(
      (item) => item.textContent === 'Test connection',
    );
    button?.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Test failed: no_key'));
    expect(root.querySelector('input[type="password"]')?.getAttribute('value')).toBeNull();
  });
});