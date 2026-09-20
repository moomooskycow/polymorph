import { describe, expect, it } from 'vitest';
import {
  DiagnosticRing,
  formatDiagnostics,
  lastActivityAt,
  summarize,
  type DiagnosticEvent,
  type DiagnosticsSnapshot,
} from './diagnostics';
import { emptyCounters } from './types';

function event(at: number, outcome: DiagnosticEvent['outcome']): DiagnosticEvent {
  return { at, host: 'x.com', outcome, ruleId: 'rage-bait', textLength: 120 };
}

describe('US-011 diagnostics ring', () => {
  it('US-011 the ring is bounded and drops the oldest first', () => {
    const ring = new DiagnosticRing(3);
    for (let index = 0; index < 5; index += 1) ring.push(event(index, 'left'));
    expect(ring.size).toBe(3);
    expect(ring.list().map((item) => item.at)).toEqual([2, 3, 4]);
  });

  it('US-011 restore keeps the newest entries within the limit', () => {
    const ring = new DiagnosticRing(2);
    ring.restore([event(1, 'left'), event(2, 'left'), event(3, 'left')]);
    expect(ring.list().map((item) => item.at)).toEqual([2, 3]);
    ring.clear();
    expect(ring.size).toBe(0);
  });

  it('US-011 lastActivityAt and summarize read the structured fields', () => {
    const events = [event(10, 'transformed'), event(30, 'error'), event(20, 'transformed')];
    expect(lastActivityAt(events)).toBe(30);
    expect(lastActivityAt([])).toBeNull();
    expect(summarize(events)).toEqual({ transformed: 2, error: 1 });
  });
});

describe('US-011 redacted diagnostics text', () => {
  const snapshot: DiagnosticsSnapshot = {
    version: '0.2.0',
    generatedAt: 100_000,
    paused: true,
    pausedForMs: 4_000,
    activeRules: ['Rage bait'],
    totals: { ...emptyCounters(), transformed: 3, skipped: 9, errors: 1 },
    currentSite: { host: 'x.com', allowed: true, denied: false, masterEnabled: true },
    tabs: [],
    recent: [
      {
        at: 95_000,
        host: 'x.com',
        outcome: 'error',
        ruleId: 'rage-bait',
        errorKind: 'timeout',
        textLength: 140,
        durationMs: 20_000,
      },
    ],
  };

  it('US-011 the copy text carries counters, kinds, and lengths only', () => {
    const text = formatDiagnostics(snapshot);
    expect(text).toContain('version: 0.2.0');
    expect(text).toContain('transformed=3');
    expect(text).toContain('chars=140');
    expect(text).toContain('error=timeout');
    expect(text).toContain('rule=rage-bait');
    expect(text).toContain('provider paused: true');
    expect(text).toContain('last activity: 5s ago');
    // No free-text field exists anywhere in the snapshot type; assert the
    // formatter cannot smuggle one in under a familiar label.
    expect(text).not.toMatch(/\btext[:=]/i);
  });
});