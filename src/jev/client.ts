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

export type JevErrorKind = 'http' | 'network' | 'timeout' | 'parse';

export type JevResult =
  | { ok: true; payload: unknown }
  | { ok: false; kind: JevErrorKind; status?: number };

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/**
 * QA/self-host hook: honors a storage.local override for the Jev endpoint.
 * Inert in production unless someone explicitly sets `jevEndpointOverride`.
 */
export async function resolveEndpoint(): Promise<string> {
  try {
    const raw = await chrome.storage.local.get('jevEndpointOverride');
    const override = raw['jevEndpointOverride'];
    if (typeof override === 'string' && override.startsWith('https://')) return override;
  } catch {
    // No extension storage (pure unit tests); use the default endpoint.
  }
  return JEV_ENDPOINT;
}

/**
 * US-006/US-010: detailed result so the caller can distinguish timeouts and
 * 429/5xx (backoff) from a bad payload (no backoff). Any failure is fail-open.
 */
export async function requestJevDetailed(options: RequestJevOptions): Promise<JevResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = await resolveEndpoint();
  const signals = [timeoutSignal(options.timeoutMs ?? JEV_TIMEOUT_MS)];
  if (options.signal) signals.push(options.signal);
  try {
    const response = await fetchImpl(endpoint, {
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
    if (!response.ok) return { ok: false, kind: 'http', status: response.status };
    try {
      return { ok: true, payload: (await response.json()) as unknown };
    } catch {
      return { ok: false, kind: 'parse' };
    }
  } catch (error) {
    return { ok: false, kind: isTimeoutError(error) ? 'timeout' : 'network' };
  }
}

/** True for failures worth pausing new calls for: 429, 5xx, timeout, network. */
export function isRetryableFailure(failure: { kind: JevErrorKind; status?: number }): boolean {
  if (failure.kind === 'timeout' || failure.kind === 'network') return true;
  if (failure.kind === 'http') {
    const status = failure.status ?? 0;
    return status === 429 || status >= 500;
  }
  return false;
}

/**
 * US-006: any network error, timeout, non-OK status, or bad JSON resolves to
 * null. Callers leave the post visible; there is no retry loop here.
 */
export async function requestJev(options: RequestJevOptions): Promise<unknown | null> {
  const result = await requestJevDetailed(options);
  return result.ok ? result.payload : null;
}