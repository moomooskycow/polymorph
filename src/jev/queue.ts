/**
 * US-002 concurrency cap: at most `max` Jev calls in flight, extra tasks wait
 * in FIFO order. A plain counter plus queue; no timers.
 */
export class Limiter {
  readonly #max: number;
  #active = 0;
  readonly #queue: Array<() => void> = [];

  constructor(max: number) {
    this.#max = Math.max(1, Math.floor(max));
  }

  get active(): number {
    return this.#active;
  }

  get pending(): number {
    return this.#queue.length;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.#active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.#active -= 1;
            const next = this.#queue.shift();
            if (next) next();
          });
      };
      if (this.#active < this.#max) start();
      else this.#queue.push(start);
    });
  }
}