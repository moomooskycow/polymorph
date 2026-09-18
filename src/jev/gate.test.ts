import { describe, expect, it } from 'vitest';
import { evaluateAnswer } from './gate';

const passing = {
  type: 'choice',
  choice: 'match',
  probabilities: { match: 0.94, no_match: 0.06 },
  confidence: 0.88,
};

describe('US-006 gate', () => {
  it('US-006 collapses a confident match', () => {
    expect(evaluateAnswer(passing)).toEqual({ kind: 'collapse', probability: 0.94, confidence: 0.88 });
  });

  it('US-006 leaves a no_match choice alone even with high confidence', () => {
    expect(evaluateAnswer({ ...passing, choice: 'no_match' })).toEqual({
      kind: 'leave',
      reason: 'choice',
    });
  });

  it('US-006 leaves a match probability at or below 0.85', () => {
    expect(
      evaluateAnswer({ ...passing, probabilities: { match: 0.85, no_match: 0.15 } }),
    ).toEqual({ kind: 'leave', reason: 'probability' });
    expect(
      evaluateAnswer({ ...passing, probabilities: { match: 0.84, no_match: 0.16 } }),
    ).toEqual({ kind: 'leave', reason: 'probability' });
    expect(
      evaluateAnswer({ ...passing, probabilities: { match: 0.8500001, no_match: 0.15 } }),
    ).toEqual({ kind: 'collapse', probability: 0.8500001, confidence: 0.88 });
  });

  it('US-006 accepts confidence exactly 0.70 and rejects below it', () => {
    expect(evaluateAnswer({ ...passing, confidence: 0.7 })).toEqual({
      kind: 'collapse',
      probability: 0.94,
      confidence: 0.7,
    });
    expect(evaluateAnswer({ ...passing, confidence: 0.699 })).toEqual({
      kind: 'leave',
      reason: 'confidence',
    });
  });

  it('US-006 leaves malformed answers alone (fail open)', () => {
    expect(evaluateAnswer(undefined)).toEqual({ kind: 'leave', reason: 'missing' });
    expect(evaluateAnswer(null)).toEqual({ kind: 'leave', reason: 'missing' });
    expect(evaluateAnswer('match')).toEqual({ kind: 'leave', reason: 'missing' });
    expect(evaluateAnswer({ choice: 'match' })).toEqual({ kind: 'leave', reason: 'probability' });
    expect(
      evaluateAnswer({ choice: 'match', probabilities: {}, confidence: 0.9 }),
    ).toEqual({ kind: 'leave', reason: 'probability' });
    expect(
      evaluateAnswer({ choice: 'match', probabilities: { match: Number.NaN }, confidence: 0.9 }),
    ).toEqual({ kind: 'leave', reason: 'probability' });
    expect(
      evaluateAnswer({ choice: 'match', probabilities: { match: 0.9 }, confidence: '0.9' }),
    ).toEqual({ kind: 'leave', reason: 'confidence' });
    expect(
      evaluateAnswer({ choice: 'match', probabilities: { match: 0.9 }, confidence: Number.NaN }),
    ).toEqual({ kind: 'leave', reason: 'confidence' });
  });
});