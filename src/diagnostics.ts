import { DIAGNOSTIC_LIMIT } from './defaults';
import { emptyCounters, type TabCounters } from './types';

/**
 * US-011 diagnostics. Events carry structured metadata only: never post text,
 * never the key. Text length is the only thing derived from content, and that
 * is a number. The type makes text storage impossible by construction.
 */
export type OutcomeKind =
  | 'queued'
  | 'evaluated'
  | 'transformed'
  | 'left'
  | 'skipped'
  | 'restored'
  | 'deferred'
  | 'error'
  | 'connection_test';

export type ErrorKind = 'http' | 'network' | 'timeout' | 'parse' | 'no_key';

export interface DiagnosticEvent {
  at: number;
  host: string;
  outcome: OutcomeKind;
  ruleId?: string;
  assetId?: string;
  durationMs?: number;
  errorKind?: ErrorKind;
  /** Character count only; never the text itself. */
  textLength?: number;
}

/** Bounded ring buffer; oldest entries drop first. */
export class DiagnosticRing {
  readonly #limit: number;
  #items: DiagnosticEvent[] = [];

  constructor(limit = DIAGNOSTIC_LIMIT) {
    this.#limit = Math.max(1, limit);
  }

  push(event: DiagnosticEvent): void {
    this.#items.push(event);
    if (this.#items.length > this.#limit) this.#items.splice(0, this.#items.length - this.#limit);
  }

  list(): DiagnosticEvent[] {
    return [...this.#items];
  }

  clear(): void {
    this.#items = [];
  }

  get size(): number {
    return this.#items.length;
  }

  restore(events: readonly DiagnosticEvent[]): void {
    this.#items = [];
    for (const event of events.slice(-this.#limit)) this.#items.push(event);
  }
}

export interface TabDiagnostics {
  tabId: number;
  host: string;
  counters: TabCounters;
  lastAt: number;
}

export interface DiagnosticsSnapshot {
  version: string;
  generatedAt: number;
  paused: boolean;
  pausedForMs: number;
  activeRules: string[];
  totals: TabCounters;
  currentSite: {
    host: string;
    allowed: boolean;
    denied: boolean;
    masterEnabled: boolean;
  };
  tabs: TabDiagnostics[];
  recent: DiagnosticEvent[];
}

export function lastActivityAt(events: readonly DiagnosticEvent[]): number | null {
  let latest: number | null = null;
  for (const event of events) {
    if (latest === null || event.at > latest) latest = event.at;
  }
  return latest;
}

export function summarize(events: readonly DiagnosticEvent[]): Partial<Record<OutcomeKind, number>> {
  const counts: Partial<Record<OutcomeKind, number>> = {};
  for (const event of events) {
    counts[event.outcome] = (counts[event.outcome] ?? 0) + 1;
  }
  return counts;
}

function age(ms: number): string {
  if (ms < 1_000) return 'just now';
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Redacted text for "Copy diagnostics". Structured fields only; the ring
 * cannot contain post text or keys, and this function adds none.
 */
export function formatDiagnostics(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];
  lines.push('Polymorph diagnostics');
  lines.push(`version: ${snapshot.version}`);
  lines.push(`generated: ${new Date(snapshot.generatedAt).toISOString()}`);
  lines.push(`site: ${snapshot.currentSite.host || '(no host)'}`);
  lines.push(
    `site state: allowed=${snapshot.currentSite.allowed} denied=${snapshot.currentSite.denied} master=${snapshot.currentSite.masterEnabled}`,
  );
  lines.push(`provider paused: ${snapshot.paused} (${snapshot.pausedForMs}ms remaining)`);
  lines.push(`active rules: ${snapshot.activeRules.join(', ') || '(none)'}`);
  const totals = { ...emptyCounters(), ...snapshot.totals };
  lines.push(
    `counters: discovered=${totals.discovered} queued=${totals.queued} evaluated=${totals.evaluated} transformed=${totals.transformed} skipped=${totals.skipped} errors=${totals.errors} restored=${totals.restored}`,
  );
  const last = lastActivityAt(snapshot.recent);
  lines.push(`last activity: ${last === null ? '(none)' : `${age(snapshot.generatedAt - last)}`}`);
  lines.push(`recent outcomes (${snapshot.recent.length}):`);
  for (const event of snapshot.recent) {
    const parts = [
      new Date(event.at).toISOString(),
      event.host,
      event.outcome,
      event.ruleId ? `rule=${event.ruleId}` : null,
      event.assetId ? `asset=${event.assetId}` : null,
      event.durationMs === undefined ? null : `${event.durationMs}ms`,
      event.errorKind ? `error=${event.errorKind}` : null,
      event.textLength === undefined ? null : `chars=${event.textLength}`,
    ].filter((part): part is string => part !== null);
    lines.push(`  ${parts.join(' ')}`);
  }
  return lines.join('\n');
}