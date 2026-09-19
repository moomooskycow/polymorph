import { JEV_ENDPOINT, JEV_MODEL, JEV_TIMEOUT_MS, MAX_STATE_CHARS } from '../defaults';
import type { ChoiceQuestion } from '../policy';

export interface JevBody {
  model: string;
  state: string;
  questions: Record<string, ChoiceQuestion>;
}

/**
 * US-002: one post per request. State is JSON text with the host and exactly
 * one post's visible text. No author ids, no HTML, no cookies, capped at
 * MAX_STATE_CHARS by trimming the text (never by dropping the site).
 */
export function buildState(host: string, text: string, cap = MAX_STATE_CHARS): string {
  const full = JSON.stringify({ site: host, text });
  if (full.length <= cap) return full;

  const points = Array.from(text);
  let low = 0;
  let high = points.length;
  let best = '';
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = JSON.stringify({ site: host, text: points.slice(0, mid).join('') });
    if (candidate.length <= cap) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best || JSON.stringify({ site: host, text: '' });
}

export function buildJevBody(args: {
  host: string;
  text: string;
  questions: Record<string, ChoiceQuestion>;
}): string {
  const body: JevBody = {
    model: JEV_MODEL,
    state: buildState(args.host, args.text),
    questions: args.questions,
  };
  return JSON.stringify(body);
}

/** Returns `answers` from a Jev response, or null when the envelope is wrong. */
export function parseAnswers(payload: unknown): Record<string, unknown> | null {
  if (payload === null || typeof payload !== 'object') return null;
  const answers = (payload as Record<string, unknown>).answers;
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return null;
  return answers as Record<string, unknown>;
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), ms);
  return controller.signal;
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export interface RequestJevOptions {
  apiKey: string;
  body: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const JEV_REFERER = 'https://github.com/moomooskycow/polymorph';
export const JEV_TITLE = 'Polymorph';

/**
 * US-006: any network error, timeout, non-OK status, or bad JSON resolves to
 * null. Callers leave the post visible; there is no retry loop here.
 */
export async function requestJev(options: RequestJevOptions): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signals = [timeoutSignal(options.timeoutMs ?? JEV_TIMEOUT_MS)];
  if (options.signal) signals.push(options.signal);
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': JEV_REFERER,
        'X-Title': JEV_TITLE,
      },
      body: options.body,
      signal: combineSignals(signals),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}