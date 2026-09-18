import type { Rule } from './types';
import { evaluateAnswer } from './jev/gate';

/** One parallel choice question: does this post match this rule? */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: {
    match: string;
    no_match: string;
  };
}

export function enabledRules(rules: readonly Rule[]): Rule[] {
  return rules.filter((rule) => rule.enabled);
}

export function questionForRule(rule: Rule): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: [
      `The operator's rule "${rule.name}" says: ${rule.instructions}`,
      'Decide whether the post in the state satisfies that rule.',
      'The rule may name exceptions. If an exception applies, answer no_match.',
      'Judge only the post, not the author or the platform.',
    ].join(' '),
    criteria: {
      match: 'The post satisfies the rule, and any exception the rule names does not apply.',
      no_match: 'The post does not satisfy the rule, or an exception the rule names applies.',
    },
  };
}

/**
 * US-001: every enabled rule becomes one parallel choice question keyed by the
 * rule id. Disabled rules are omitted. No enabled rules means an empty object,
 * and the caller must not call Jev.
 */
export function questionsForRules(rules: readonly Rule[]): Record<string, ChoiceQuestion> {
  const questions: Record<string, ChoiceQuestion> = {};
  for (const rule of enabledRules(rules)) {
    questions[rule.id] = questionForRule(rule);
  }
  return questions;
}

export interface ScoredRule {
  rule: Rule;
  probability: number;
  confidence: number;
}

/**
 * US-002: pick the single rule whose answer passes the gate. Highest match
 * probability wins; ties break on confidence, then on rule order for stability.
 * Disabled rules are ignored even if the model answered them.
 */
export function pickMatch(
  answers: Record<string, unknown>,
  rules: readonly Rule[],
): ScoredRule | null {
  let best: ScoredRule | null = null;
  for (const rule of enabledRules(rules)) {
    const verdict = evaluateAnswer(answers[rule.id]);
    if (verdict.kind !== 'collapse') continue;
    if (
      best === null ||
      verdict.probability > best.probability ||
      (verdict.probability === best.probability && verdict.confidence > best.confidence)
    ) {
      best = { rule, probability: verdict.probability, confidence: verdict.confidence };
    }
  }
  return best;
}