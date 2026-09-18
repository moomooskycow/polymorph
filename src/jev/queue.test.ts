import { describe, expect, it } from 'vitest';
import { Limiter } from './queue';

describe('US-002 Jev concurrency cap', () => {
  it('US-002 never runs more than four tasks at once', async () => {
    const limiter = new Limiter(4);
    let active = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];

    const tasks = Array.from({ length: 10 }, () =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        active -= 1;
      }),
    );

    await Promise.resolve();
    expect(limiter.active).toBe(4);
    expect(limiter.pending).toBe(6);

    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await Promise.resolve();
    }
    await Promise.all(tasks);
    expect(peak).toBe(4);
    expect(limiter.active).toBe(0);
  });

  it('US-006 a rejected task frees its slot', async () => {
    const limiter = new Limiter(1);
    const failed = limiter.run(async () => {
      throw new Error('jev down');
    });
    await expect(failed).rejects.toThrow('jev down');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });
});