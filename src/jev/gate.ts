import { GATE_CONFIDENCE, GATE_PROBABILITY } from '../defaults';

/** Result of applying the contract gate to one choice answer. */
export type GateVerdict =
  | { kind: 'collapse'; probability: number; confidence: number }
  | { kind: 'leave'; reason: 'choice' | 'probability' | 'confidence' | 'missing' };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * US-006 gate: `choice === "match"` AND `probabilities.match > 0.85` AND
 * `confidence >= 0.70`. Anything else leaves the post visible.
 */
export function evaluateAnswer(raw: unknown): GateVerdict {
  if (raw === null || typeof raw !== 'object') return { kind: 'leave', reason: 'missing' };
  const answer = raw as Record<string, unknown>;
  if (answer.choice !== 'match') return { kind: 'leave', reason: 'choice' };

  const probabilities = answer.probabilities;
  const probability =
    probabilities !== null && typeof probabilities === 'object'
      ? (probabilities as Record<string, unknown>).match
      : undefined;
  if (!isFiniteNumber(probability) || !(probability > GATE_PROBABILITY)) {
    return { kind: 'leave', reason: 'probability' };
  }

  const confidence = answer.confidence;
  if (!isFiniteNumber(confidence) || !(confidence >= GATE_CONFIDENCE)) {
    return { kind: 'leave', reason: 'confidence' };
  }

  return { kind: 'collapse', probability, confidence };
}