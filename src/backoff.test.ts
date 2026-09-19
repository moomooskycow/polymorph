import { describe, expect, it } from 'vitest';
import { Backoff } from './backoff';

describe('US-010 provider backoff', () => {
  it('US-010 first failure pauses for the base delay, then doubles', () => {
    const backoff = new Backoff(5_000, 60_000);
    expect(backoff.noteFailure(1_000)).toBe(5_000);
    expect(backoff.isPaused(1_000)).toBe(true);
    expect(backoff.isPaused(6_000)).toBe(false);
    expect(backoff.noteFailure(10_000)).toBe(10_000);
    expect(backoff.noteFailure(30_000)).toBe(20_000);
  });

  it('US-010 the delay caps at the maximum', () => {
    const backoff = new Backoff(5_000, 20_000);
    expect(backoff.noteFailure(0)).toBe(5_000);
    expect(backoff.noteFailure(0)).toBe(10_000);
    expect(backoff.noteFailure(0)).toBe(20_000);
    expect(backoff.noteFailure(0)).toBe(20_000);
  });

  it('US-010 retryAfterMs counts down and success resets everything', () => {
    const backoff = new Backoff(5_000, 60_000);
    backoff.noteFailure(0);
    expect(backoff.retryAfterMs(2_000)).toBe(3_000);
    expect(backoff.retryAfterMs(9_000)).toBe(0);
    backoff.noteSuccess();
    expect(backoff.isPaused(0)).toBe(false);
    expect(backoff.failures).toBe(0);
    expect(backoff.noteFailure(0)).toBe(5_000);
  });
});