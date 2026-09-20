import type { MediaAsset, MediaAssetMeta } from './types';

export interface MediaStore {
  list(): Promise<MediaAssetMeta[]>;
  get(id: string): Promise<MediaAsset | undefined>;
  add(asset: MediaAsset): Promise<void>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

/** Thrown when the browser refuses the write because the origin is out of quota. */
export class MediaQuotaError extends Error {
  constructor() {
    super('Storage quota exceeded');
    this.name = 'MediaQuotaError';
  }
}

const DB_NAME = 'polymorph-media';
const DB_VERSION = 1;
const STORE = 'assets';

interface StoredRecord {
  id: string;
  kind: MediaAssetMeta['kind'];
  mime: string;
  size: number;
  addedAt: number;
  width: number;
  height: number;
  thumb: string | null;
  blob: Blob;
}

function toMeta(record: StoredRecord): MediaAssetMeta {
  return {
    id: record.id,
    kind: record.kind,
    mime: record.mime,
    size: record.size,
    addedAt: record.addedAt,
    width: record.width,
    height: record.height,
    thumb: record.thumb,
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/** IndexedDB-backed library. One record per asset; blob + small thumb. */
export class IdbMediaStore implements MediaStore {
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
  }

  static async open(): Promise<IdbMediaStore> {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    const db = await requestToPromise(request);
    return new IdbMediaStore(db);
  }

  async list(): Promise<MediaAssetMeta[]> {
    const store = this.#db.transaction(STORE, 'readonly').objectStore(STORE);
    const records = await requestToPromise(store.getAll() as IDBRequest<StoredRecord[]>);
    return records
      .sort((a, b) => (a.addedAt === b.addedAt ? a.id.localeCompare(b.id) : a.addedAt - b.addedAt))
      .map(toMeta);
  }

  async get(id: string): Promise<MediaAsset | undefined> {
    const store = this.#db.transaction(STORE, 'readonly').objectStore(STORE);
    const record = await requestToPromise(store.get(id) as IDBRequest<StoredRecord | undefined>);
    if (record === undefined) return undefined;
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    return { ...toMeta(record), bytes };
  }

  async add(asset: MediaAsset): Promise<void> {
    const record: StoredRecord = {
      id: asset.id,
      kind: asset.kind,
      mime: asset.mime,
      size: asset.size,
      addedAt: asset.addedAt,
      width: asset.width,
      height: asset.height,
      thumb: asset.thumb,
      blob: new Blob([asset.bytes as unknown as BlobPart], { type: asset.mime }),
    };
    try {
      const tx = this.#db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
      });
    } catch (error) {
      if (isQuotaError(error)) throw new MediaQuotaError();
      throw error;
    }
  }

  async remove(id: string): Promise<boolean> {
    const tx = this.#db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const existing = await requestToPromise(store.get(id) as IDBRequest<StoredRecord | undefined>);
    if (existing !== undefined) store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
    return existing !== undefined;
  }

  async clear(): Promise<void> {
    const tx = this.#db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
    });
  }
}

/**
 * In-memory implementation with shareable backing, used by unit tests and as
 * a fallback when IndexedDB is unavailable. Passing the same Map to two
 * instances models an extension restart over the same origin store.
 */
export class MemoryMediaStore implements MediaStore {
  readonly #backing: Map<string, MediaAsset>;

  constructor(backing: Map<string, MediaAsset> = new Map()) {
    this.#backing = backing;
  }

  async list(): Promise<MediaAssetMeta[]> {
    return [...this.#backing.values()]
      .sort((a, b) => (a.addedAt === b.addedAt ? a.id.localeCompare(b.id) : a.addedAt - b.addedAt))
      .map(({ bytes: _bytes, ...meta }) => meta);
  }

  async get(id: string): Promise<MediaAsset | undefined> {
    return this.#backing.get(id);
  }

  async add(asset: MediaAsset): Promise<void> {
    this.#backing.set(asset.id, asset);
  }

  async remove(id: string): Promise<boolean> {
    return this.#backing.delete(id);
  }

  async clear(): Promise<void> {
    this.#backing.clear();
  }
}