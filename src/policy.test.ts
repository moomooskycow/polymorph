import { describe, expect, it } from 'vitest';
import { EXAMPLE_RULES } from './defaults';
import { enabledRules, pickMatch, questionForRule, questionsForRules } from './policy';
import type { Rule } from './types';

function rule(overrides: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    name: overrides.id,
    instructions: `Instruction for ${overrides.id}`,
    enabled: true,
    ...overrides,
  };
}

const answer = (probability: number, confidence: number, choice: string = 'match') => ({
  type: 'choice',
  choice,
  probabilities: { match: probability, no_match: 1 - probability },
  confidence,
});

describe('US-001 policy: rules become Jev questions', () => {
  it('US-001 disabled rules are omitted from the questions', () => {
    const rules = [
      rule({ id: 'on', enabled: true }),
      rule({ id: 'off', enabled: false }),
    ];
    const questions = questionsForRules(rules);
    expect(Object.keys(questions)).toEqual(['on']);
    expect(questions.off).toBeUndefined();
  });

  it('US-001 every enabled rule is a parallel choice question keyed by rule id', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b' }), rule({ id: 'c' })];
    const questions = questionsForRules(rules);
    expect(Object.keys(questions).sort()).toEqual(['a', 'b', 'c']);
    for (const question of Object.values(questions)) {
      expect(question.type).toBe('choice');
      expect(Object.keys(question.criteria).sort()).toEqual(['match', 'no_match']);
      expect(question.instructions.length).toBeGreaterThan(20);
    }
  });

  it('US-001 the question carries the rule name and full English instruction', () => {
    const rules = [rule({ id: 'rage', name: 'Rage bait', instructions: 'Engineered outrage.' })];
    const question = questionForRule(rules[0]!);
    expect(question.instructions).toContain('Rage bait');
    expect(question.instructions).toContain('Engineered outrage.');
    expect(question.instructions).toMatch(/exception/i);
  });

  it('US-001 no enabled rules makes no questions, so Jev is never called', () => {
    expect(questionsForRules(EXAMPLE_RULES)).toEqual({});
    expect(enabledRules(EXAMPLE_RULES)).toEqual([]);
    expect(questionsForRules([])).toEqual({});
  });
});

describe('US-002 pick the matching rule', () => {
  it('US-002 picks the highest passing probability, ignoring disabled and failed answers', () => {
    const rules = [
      rule({ id: 'low' }),
      rule({ id: 'high' }),
      rule({ id: 'disabled', enabled: false }),
      rule({ id: 'rejected' }),
    ];
    const match = pickMatch(
      {
        low: answer(0.9, 0.8),
        high: answer(0.99, 0.8),
        disabled: answer(0.999, 0.99),
        rejected: answer(0.84, 0.99),
      },
      rules,
    );
    expect(match?.rule.id).toBe('high');
    expect(match?.probability).toBe(0.99);
    expect(match?.confidence).toBe(0.8);
  });

  it('US-002 breaks probability ties on confidence', () => {
    const rules = [rule({ id: 'first' }), rule({ id: 'second' })];
    const match = pickMatch({ first: answer(0.9, 0.75), second: answer(0.9, 0.9) }, rules);
    expect(match?.rule.id).toBe('second');
  });

  it('US-006 returns null when nothing passes the gate', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b' })];
    expect(pickMatch({}, rules)).toBeNull();
    expect(pickMatch({ a: answer(0.85, 0.9), b: answer(0.99, 0.69) }, rules)).toBeNull();
  });
});