import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * US-001: the install race was an install-time writer clobbering settings that
 * were written while `onInstalled` was still running. The architecture is now
 * "defaults are virtual, merged on read", so the install path must perform no
 * storage writes at all.
 */
function stubChrome(): { installed: Array<() => void>; set: ReturnType<typeof vi.fn> } {
  const installed: Array<() => void> = [];
  const set = vi.fn(async () => {});
  vi.stubGlobal('chrome', {
    runtime: {
      onInstalled: { addListener: (listener: () => void) => installed.push(listener) },
      onMessage: { addListener: vi.fn() },
      getManifest: () => ({ version: '0.3.0' }),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set,
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
      },
      onChanged: { addListener: vi.fn() },
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
    },
  });
  return { installed, set };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('US-001 install path performs no storage writes', () => {
  it('US-001 onInstalled never materializes defaults over existing settings', async () => {
    const { installed, set } = stubChrome();
    await import('./background');
    for (const listener of installed) listener();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(set).not.toHaveBeenCalled();
  });
});