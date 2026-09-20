import { describe, expect, it } from 'vitest';
import { MAX_STATE_CHARS } from '../defaults';
import { questionForRule } from '../policy';
import type { Rule } from '../types';
import { buildJevBody, buildState, parseAnswers, requestJev, JEV_REFERER, JEV_TITLE } from './client';

const rule: Rule = {
  id: 'rage-bait',
  name: 'Rage bait',
  instructions: 'Engineered outrage.',
  enabled: true,
};

describe('US-002 Jev request shape', () => {
  it('US-002 puts exactly one post and the host into state', () => {
    const state = JSON.parse(buildState('x.com', 'One visible post.')) as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(['site', 'text']);
    expect(state.site).toBe('x.com');
    expect(state.text).toBe('One visible post.');
  });

  it('US-002 sends visible text only, with no extra state fields', () => {
    const body = JSON.parse(
      buildJevBody({
        host: 'x.com',
        text: 'Some post',
        questions: { 'rage-bait': questionForRule(rule) },
      }),
    ) as Record<string, unknown>;
    expect(body.model).toBe('typesafe/jev-1.13');
    expect(JSON.parse(body.state as string)).toEqual({ site: 'x.com', text: 'Some post' });
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state']);
    expect(Object.keys(body.questions as object)).toEqual(['rage-bait']);
  });

  it('US-002 caps state at 24,000 characters without corrupting JSON', () => {
    const longText = 'word '.repeat(12_000);
    const state = buildState('news.ycombinator.com', longText);
    expect(state.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
    const parsed = JSON.parse(state) as { site: string; text: string };
    expect(parsed.site).toBe('news.ycombinator.com');
    expect(longText.startsWith(parsed.text)).toBe(true);
    expect(parsed.text.length).toBeGreaterThan(0);
  });
});

describe('US-006 Jev fail-open client', () => {
  it('US-006 returns answers on a 200', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ answers: { a: { choice: 'match' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const payload = await requestJev({ apiKey: 'sk-test', body: '{}', fetchImpl });
    expect(parseAnswers(payload)).toEqual({ a: { choice: 'match' } });
  });

  it('US-006 returns null on a non-OK response, a thrown fetch, and bad JSON', async () => {
    const nonOk = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    const thrown = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const badJson = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    await expect(requestJev({ apiKey: 'sk-test', body: '{}', fetchImpl: nonOk })).resolves.toBeNull();
    await expect(requestJev({ apiKey: 'sk-test', body: '{}', fetchImpl: thrown })).resolves.toBeNull();
    await expect(requestJev({ apiKey: 'sk-test', body: '{}', fetchImpl: badJson })).resolves.toBeNull();
  });

  it('US-006 sends the key only in the Authorization header with Polymorph attribution', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenInit = init;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await requestJev({ apiKey: 'sk-secret', body: '{"model":"x"}', fetchImpl });
    expect(seenUrl).toBe('https://openrouter.ai/api/alpha/decisions');
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-secret');
    expect(headers['HTTP-Referer']).toBe(JEV_REFERER);
    expect(headers['X-Title']).toBe(JEV_TITLE);
    expect(seenInit?.body).toBe('{"model":"x"}');
  });

  it('US-006 parseAnswers rejects malformed envelopes', () => {
    expect(parseAnswers(null)).toBeNull();
    expect(parseAnswers('{}')).toBeNull();
    expect(parseAnswers({})).toBeNull();
    expect(parseAnswers({ answers: [] })).toBeNull();
    expect(parseAnswers({ answers: { a: 1 } })).toEqual({ a: 1 });
  });
});