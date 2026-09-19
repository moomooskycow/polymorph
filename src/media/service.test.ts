import { describe, expect, it } from 'vitest';
import { MemoryMediaStore, type MediaStore } from './store';
import { MediaQuotaError } from './store';
import { MediaService } from './service';
import type { MediaAsset, MediaAssetMeta } from './types';

const PngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PngHeader);
  return bytes;
}

function makeService(
  store: MediaStore,
  overrides: Partial<ConstructorParameters<typeof MediaService>[0]> = {},
): MediaService {
  let counter = 0;
  return new MediaService({
    store,
    now: () => 1_000 + counter,
    newId: () => `asset-${(counter += 1)}`,
    decode: async () => ({ width: 16, height: 12 }),
    makeThumb: async () => 'data:image/webp;base64,AAAA',
    ...overrides,
  });
}

async function addPng(service: MediaService, size = 64) {
  return service.add({ mime: 'image/png', bytes: pngBytes(size) });
}

describe('US-014 media library through settings values', () => {
  it('US-014 zero assets: list is empty and pick returns empty', async () => {
    const service = makeService(new MemoryMediaStore());
    const list = await service.list();
    expect(list.assets).toEqual([]);
    expect(list.usage.count).toBe(0);
    expect(await service.pick('post\u0000rule', [])).toEqual({ ok: true, empty: true });
  });

  it('US-014 one asset: pick returns it with bytes for local rendering', async () => {
    const service = makeService(new MemoryMediaStore());
    const added = await addPng(service);
    expect(added.ok).toBe(true);
    const pick = await service.pick('post\u0000rule', []);
    expect(pick.ok).toBe(true);
    if (pick.ok && !pick.empty) {
      expect(pick.kind).toBe('png');
      expect(pick.mime).toBe('image/png');
      expect(pick.width).toBe(16);
      expect(pick.size).toBe(64);
      expect(pick.base64.length).toBeGreaterThan(0);
    }
    const list = await service.list();
    expect(list.usage.count).toBe(1);
    expect(list.usage.totalBytes).toBe(64);
    expect(list.assets[0]?.thumb).toBe('data:image/webp;base64,AAAA');
  });

  it('US-014 multiple assets: same post keeps the same draw across rerenders', async () => {
    const service = makeService(new MemoryMediaStore());
    await addPng(service);
    await addPng(service);
    await addPng(service);
    const first = await service.pick('post text\u0000rage-bait', []);
    const second = await service.pick('post text\u0000rage-bait', []);
    expect(first.ok && second.ok && !first.empty && !second.empty && first.id === second.id).toBe(true);
    const picks = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      const pick = await service.pick(`other post ${index}\u0000rule`, []);
      if (pick.ok && !pick.empty) picks.add(pick.id);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('US-014 persistence after worker restart: a new service over the same store keeps assets', async () => {
    const backing = new Map<string, MediaAsset>();
    const first = makeService(new MemoryMediaStore(backing));
    await addPng(first);
    const restarted = makeService(new MemoryMediaStore(backing));
    const list = await restarted.list();
    expect(list.usage.count).toBe(1);
    const pick = await restarted.pick('post\u0000rule', []);
    expect(pick.ok && !pick.empty).toBe(true);
  });

  it('US-014 removal works including removing the final item', async () => {
    const service = makeService(new MemoryMediaStore());
    const first = await addPng(service);
    const second = await addPng(service);
    if (!first.ok || !second.ok) throw new Error('setup failed');
    const removed = await service.remove(first.asset.id);
    expect(removed.ok).toBe(true);
    expect(removed.usage.count).toBe(1);
    const last = await service.remove(second.asset.id);
    expect(last.usage.count).toBe(0);
    expect(await service.pick('post\u0000rule', [])).toEqual({ ok: true, empty: true });
    expect((await service.list()).assets).toEqual([]);
  });

  it('US-014 a corrupt file is rejected by the decode step and never stored', async () => {
    const store = new MemoryMediaStore();
    const service = makeService(store, {
      decode: async () => {
        throw new Error('decode failed');
      },
    });
    const result = await addPng(service);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue).toBe('corrupt');
      expect(result.message).toMatch(/corrupt|truncated/i);
    }
    expect((await service.list()).usage.count).toBe(0);
  });

  it('US-014 an oversized file is rejected before decoding or storing', async () => {
    let decoded = false;
    const guarded = makeService(new MemoryMediaStore(), {
      decode: async () => {
        decoded = true;
        return { width: 1, height: 1 };
      },
    });
    const bytes = new Uint8Array(5 * 1024 * 1024 + 1);
    bytes.set(PngHeader);
    const result = await guarded.add({ mime: 'image/png', bytes });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toBe('too_large');
    expect(decoded).toBe(false);
    expect((await guarded.list()).usage.count).toBe(0);
  });

  it('US-014 a quota failure from the store surfaces as a clear message', async () => {
    const failing: MediaStore = {
      list: async () => [],
      get: async () => undefined,
      add: async () => {
        throw new MediaQuotaError();
      },
      remove: async () => false,
      clear: async () => {},
    };
    const service = makeService(failing);
    const result = await addPng(service);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue).toBe('quota_exceeded');
      expect(result.message).toContain('100 MB');
    }
  });

  it('US-014 an unsupported file never reaches the store', async () => {
    const service = makeService(new MemoryMediaStore());
    const result = await service.add({
      mime: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toBe('unsupported');
    expect((await service.list()).assets).toEqual([]);
  });

  it('US-014 clear empties the library and usage reports zero', async () => {
    const service = makeService(new MemoryMediaStore());
    await addPng(service);
    await addPng(service);
    const usage = await service.clear();
    expect(usage.count).toBe(0);
    expect((await service.list()).assets).toEqual([]);
  });
});

describe('US-014 store primitives', () => {
  it('US-014 memory store add/get/list/remove/clear preserves bytes', async () => {
    const store = new MemoryMediaStore();
    const asset: MediaAsset = {
      id: 'x1',
      kind: 'gif',
      mime: 'image/gif',
      size: 4,
      addedAt: 1,
      width: 2,
      height: 2,
      thumb: null,
      bytes: Uint8Array.from([1, 2, 3, 4]),
    };
    await store.add(asset);
    const listed = await store.list();
    expect(listed.map((item: MediaAssetMeta) => item.id)).toEqual(['x1']);
    const fetched = await store.get('x1');
    expect(fetched?.bytes).toEqual(asset.bytes);
    expect(await store.remove('x1')).toBe(true);
    expect(await store.remove('x1')).toBe(false);
    await store.add(asset);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });
});