import { BACKOFF_BASE_MS, BACKOFF_MAX_MS } from './defaults';

/**
 * US-010 provider backoff: after a retryable Jev failure, pause new calls for
 * an exponentially growing window. Reset after any success. Pure and testable.
 */
export class Backoff {
  readonly #base: number;
  readonly #max: number;
  #failures = 0;
  #pausedUntil = 0;

  constructor(base = BACKOFF_BASE_MS, max = BACKOFF_MAX_MS) {
    this.#base = Math.max(1, base);
    this.#max = Math.max(this.#base, max);
  }

  get failures(): number {
    return this.#failures;
  }

  isPaused(now = Date.now()): boolean {
    return now < this.#pausedUntil;
  }

  retryAfterMs(now = Date.now()): number {
    return Math.max(0, this.#pausedUntil - now);
  }

  /** Records a retryable failure and returns how long this pause will last. */
  noteFailure(now = Date.now()): number {
    this.#failures += 1;
    const delay = Math.min(this.#max, this.#base * 2 ** (this.#failures - 1));
    this.#pausedUntil = now + delay;
    return delay;
  }

  noteSuccess(): void {
    this.#failures = 0;
    this.#pausedUntil = 0;
  }

  reset(): void {
    this.noteSuccess();
  }
}