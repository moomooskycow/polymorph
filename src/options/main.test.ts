import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsSnapshot } from '../diagnostics';
import { emptyCounters } from '../types';

const snapshot: DiagnosticsSnapshot = {
  version: '0.2.0',
  generatedAt: Date.now(),
  paused: false,
  pausedForMs: 0,
  activeRules: ['Rage bait'],
  totals: { ...emptyCounters(), transformed: 4, skipped: 2 },
  currentSite: { host: 'x.com', allowed: true, denied: false, masterEnabled: true },
  tabs: [],
  recent: [],
};

function stubChrome(): void {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => {
        switch (message?.type) {
          case 'hasKey':
            return { hasKey: false };
          case 'getDiagnostics':
            return snapshot;
          case 'testKey':
            return { ok: false, ms: 0, errorKind: 'no_key' };
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
    tabs: { query: vi.fn(async () => []), create: vi.fn() },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('US-007 options explains enablement', () => {
  it('US-007 shows the three-step setup block, labeled rule switches, mix previews, and diagnostics', async () => {
    stubChrome();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.getElementById('app');
    if (root === null) throw new Error('missing #app');
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Get set up — 3 steps'));

    expect(root.textContent).toContain('Turn on at least one rule');
    expect(root.textContent).toContain('Enable rule');
    expect(root.querySelectorAll('.chip').length).toBe(3);
    expect(root.querySelectorAll('input[name="replacement-mix"]').length).toBe(5);
    expect(root.querySelectorAll('.preview-thumb').length).toBeGreaterThanOrEqual(6);
    expect(root.textContent).toContain('Test connection');
    expect(root.querySelector('#diagnostics')).not.toBeNull();
    expect(root.textContent).toContain('transformed');
  });

  it('US-013 flipping Enable rule saves only the flag; other unsaved edits stay pending', async () => {
    stubChrome();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.getElementById('app');
    if (root === null) throw new Error('missing #app');
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Enable rule'));

    const articles = [...root.querySelectorAll<HTMLElement>('.rule')];
    expect(articles.length).toBe(3);
    // Unsaved text edit on the first rule.
    const firstName = articles[0]?.querySelector<HTMLInputElement>('input[type="text"]');
    if (!firstName) throw new Error('missing name input');
    firstName.value = 'Edited name that was never saved';
    firstName.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.textContent).toContain('Unsaved edits');

    // Toggle the second rule's switch.
    const secondSwitch = articles[1]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!secondSwitch) throw new Error('missing switch');
    secondSwitch.checked = true;
    secondSwitch.dispatchEvent(new Event('change', { bubbles: true }));

    const setMock = chrome.storage.local.set as unknown as { mock: { calls: unknown[][] } };
    await vi.waitFor(() => expect(setMock.mock.calls.length).toBeGreaterThan(0));
    const payload = setMock.mock.calls.at(-1)?.[0] as { rules?: { name?: string; enabled?: boolean }[] };
    const saved = payload.rules ?? [];
    expect(saved.length).toBe(3);
    // The toggle applied...
    expect(saved[1]?.enabled).toBe(true);
    // ...but the unsaved name edit was NOT committed by the toggle.
    expect(saved[0]?.name).not.toBe('Edited name that was never saved');
    // And the untouched rule stayed off.
    expect(saved[2]?.enabled).toBe(false);
  });

  it('US-012 test connection reports key state without a key', async () => {
    stubChrome();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.getElementById('app');
    if (root === null) throw new Error('missing #app');
    await import('./main');
    await vi.waitFor(() => expect(root.textContent).toContain('Test connection'));
    const button = [...root.querySelectorAll('button')].find(
      (item) => item.textContent === 'Test connection',
    );
    button?.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Test failed: no_key'));
  });
});