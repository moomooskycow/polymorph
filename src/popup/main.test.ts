import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsSnapshot } from '../diagnostics';
import { emptyCounters } from '../types';

const snapshot: DiagnosticsSnapshot = {
  version: '0.2.0',
  generatedAt: Date.now(),
  paused: false,
  pausedForMs: 0,
  activeRules: [],
  totals: { ...emptyCounters(), transformed: 2 },
  currentSite: { host: 'x.com', allowed: true, denied: false, masterEnabled: true },
  tabs: [],
  recent: [],
};

function stubChrome(options: { hasKey: boolean }): void {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => {
        switch (message?.type) {
          case 'hasKey':
            return { hasKey: options.hasKey };
          case 'getTabStats':
            return { transformed: 2, counters: { ...emptyCounters(), transformed: 2 } };
          case 'getDiagnostics':
            return snapshot;
          default:
            return { ok: true };
        }
      }),
      onMessage: { addListener: vi.fn() },
      getManifest: () => ({ version: '0.2.0' }),
      openOptionsPage: vi.fn(),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn() },
    },
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: 'https://x.com/home' }]),
      create: vi.fn(),
    },
  });
}

function app(): HTMLElement {
  document.body.innerHTML = '<main id="app"></main>';
  const node = document.getElementById('app');
  if (node === null) throw new Error('missing #app');
  return node;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('US-007 popup readiness', () => {
  it('US-007 tells the operator the key is missing before anything else', async () => {
    stubChrome({ hasKey: false });
    const root = app();
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Not set up — add your key'));
    expect(root.textContent).toContain('Rules active');
    expect(root.textContent).toContain('0 of 3');
    expect(root.textContent).toContain('Posts transformed here');
    expect(root.querySelectorAll('.switch input[type="checkbox"]').length).toBeGreaterThanOrEqual(2);
  });

  it('US-007 with a key but no active rule it says so instead of looking broken', async () => {
    stubChrome({ hasKey: true });
    const root = app();
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('No rules enabled yet'));
    expect(root.textContent).toContain('Rules active');
  });
});