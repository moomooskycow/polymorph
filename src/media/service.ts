import { bytesToBase64 } from './bytes';
import { orderedIds, pickMediaIndex } from './selection';
import { MediaQuotaError, type MediaStore } from './store';
import { validateCandidate, issueMessage, type ValidationIssue } from './validate';
import {
  emptyUsage,
  type MediaAsset,
  type MediaAssetMeta,
  type MediaKind,
  type MediaUsage,
} from './types';

export interface AddInput {
  mime: string;
  bytes: Uint8Array;
}

export type AddResult =
  | { ok: true; asset: MediaAssetMeta; usage: MediaUsage }
  | { ok: false; issue: ValidationIssue | 'store_unavailable'; message: string };

export type PickResult =
  | { ok: true; empty: true }
  | {
      ok: true;
      empty: false;
      id: string;
      kind: MediaKind;
      mime: string;
      size: number;
      width: number;
      height: number;
      base64: string;
    }
  | { ok: false; issue: ValidationIssue | 'store_unavailable' };

export interface MediaServiceDeps {
  store: MediaStore;
  now?: () => number;
  newId?: () => string;
  /** Decode check (corrupt/truncated). Wired to createImageBitmap in the worker. */
  decode?: (bytes: Uint8Array, mime: string) => Promise<{ width: number; height: number }>;
  makeThumb?: (
    bytes: Uint8Array,
    mime: string,
    width: number,
    height: number,
  ) => Promise<string | null>;
}

function randomId(): string {
  return crypto.randomUUID();
}

/**
 * US-014: the library service. Validation, quota, selection, and byte
 * transport live here; the worker owns the only writer to IndexedDB.
 */
export class MediaService {
  readonly #store: MediaStore;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #decode:
    | ((bytes: Uint8Array, mime: string) => Promise<{ width: number; height: number }>)
    | undefined;
  readonly #makeThumb:
    | ((bytes: Uint8Array, mime: string, width: number, height: number) => Promise<string | null>)
    | undefined;

  constructor(deps: MediaServiceDeps) {
    this.#store = deps.store;
    this.#now = deps.now ?? (() => Date.now());
    this.#newId = deps.newId ?? randomId;
    this.#decode = deps.decode;
    this.#makeThumb = deps.makeThumb;
  }

  async usage(): Promise<MediaUsage> {
    const assets = await this.#store.list();
    return {
      ...emptyUsage(),
      count: assets.length,
      totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
    };
  }

  async list(): Promise<{ assets: MediaAssetMeta[]; usage: MediaUsage }> {
    const assets = await this.#store.list();
    return {
      assets,
      usage: {
        ...emptyUsage(),
        count: assets.length,
        totalBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
      },
    };
  }

  async add(input: AddInput): Promise<AddResult> {
    const usage = await this.usage();
    const checked = validateCandidate({
      bytes: input.bytes,
      library: { count: usage.count, totalBytes: usage.totalBytes },
    });
    if (!checked.ok) return checked;

    const { kind, mime } = checked.media;
    let width = 0;
    let height = 0;
    if (this.#decode !== undefined) {
      try {
        const size = await this.#decode(input.bytes, mime);
        width = size.width;
        height = size.height;
      } catch {
        return { ok: false, issue: 'corrupt', message: issueMessage('corrupt') };
      }
    } else if (this.#makeThumb !== undefined) {
      // Decoding is still required when only the thumbnailer is wired; a
      // decode failure means corrupt bytes.
      try {
        await this.#makeThumb(input.bytes, mime, 0, 0);
      } catch {
        return { ok: false, issue: 'corrupt', message: issueMessage('corrupt') };
      }
    }

    let thumb: string | null = null;
    if (this.#makeThumb !== undefined) {
      try {
        thumb = await this.#makeThumb(input.bytes, mime, width, height);
      } catch {
        thumb = null;
      }
    }

    const asset: MediaAsset = {
      id: this.#newId(),
      kind,
      mime,
      size: input.bytes.length,
      addedAt: this.#now(),
      width,
      height,
      thumb,
      bytes: input.bytes,
    };
    try {
      await this.#store.add(asset);
    } catch (error) {
      if (error instanceof MediaQuotaError) {
        return { ok: false, issue: 'quota_exceeded', message: issueMessage('quota_exceeded') };
      }
      return {
        ok: false,
        issue: 'store_unavailable',
        message: 'The library could not be saved. Try again.',
      };
    }
    return { ok: true, asset, usage: await this.usage() };
  }

  async remove(id: string): Promise<{ ok: boolean; usage: MediaUsage }> {
    const removed = await this.#store.remove(id);
    return { ok: removed, usage: await this.usage() };
  }

  async clear(): Promise<MediaUsage> {
    await this.#store.clear();
    return this.usage();
  }

  /** US-014: stable pick over the ordered pile, recency-aware. */
  async pick(key: string, recent: readonly string[]): Promise<PickResult> {
    const assets = await this.#store.list();
    const ids = orderedIds(assets);
    const index = pickMediaIndex(key, ids, recent);
    if (index === null) return { ok: true, empty: true };
    const meta = assets.find((asset) => asset.id === ids[index]);
    if (meta === undefined) return { ok: true, empty: true };
    const asset = await this.#store.get(meta.id);
    if (asset === undefined) return { ok: true, empty: true };
    return {
      ok: true,
      empty: false,
      id: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      base64: bytesToBase64(asset.bytes),
    };
  }
}