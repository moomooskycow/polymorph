import type { Decision } from '../types';

/** SHA-256 hex. Stable key for "same post text, same session". */
export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * US-006 session cache. In-memory, insertion-ordered, bounded. The background
 * worker mirrors it into chrome.storage.session so a worker restart keeps the
 * session's decisions.
 */
export class DecisionCache {
  readonly #entries = new Map<string, Decision>();
  readonly #maxEntries: number;

  constructor(maxEntries = 500) {
    this.#maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(hash: string): Decision | undefined {
    return this.#entries.get(hash);
  }

  set(hash: string, decision: Decision): void {
    if (this.#entries.has(hash)) this.#entries.delete(hash);
    else if (this.#entries.size >= this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) this.#entries.delete(oldest);
    }
    this.#entries.set(hash, decision);
  }

  clear(): void {
    this.#entries.clear();
  }

  snapshot(): Record<string, Decision> {
    return Object.fromEntries(this.#entries);
  }

  restore(data: Record<string, Decision>): void {
    for (const [hash, decision] of Object.entries(data)) {
      if (decision && typeof decision === 'object' && 'verdict' in decision) {
        this.set(hash, decision);
      }
    }
  }
}