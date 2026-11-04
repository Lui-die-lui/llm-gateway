import type { AnalyzeSpan, AuditEvent } from '../api/types';

export const fmt = (n: number | null | undefined): string => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('ko-KR'));

export const pct = (part: number, whole: number, digits = 1): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '—';

/** "+12.4%" style change vs. a previous value; null when there is nothing to compare with. */
export function delta(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  const dir = Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down';
  return { text: `${d > 0 ? '+' : ''}${d.toFixed(1)}%`, dir };
}

/** A change is only worth showing when there is enough in the previous period: 1 → 0 is "-100%" but says nothing. */
export const MIN_COMPARE_BASE = 5;
export function compare(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  return prev < MIN_COMPARE_BASE ? null : delta(cur, prev);
}

/** Milliseconds as they are: a masking call is often well under 1 ms, which must not read as "0ms". */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1) return '<1ms';
  return ms < 10 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`;
}

const two = (n: number) => String(n).padStart(2, '0');

export function hms(ts: number): string {
  const d = new Date(ts * 1000);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export function ymdhms(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${hms(ts)}`;
}

export function startOfToday(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

export const daysAgo = (n: number, now = new Date()): number => startOfToday(now) - n * 86400;

/**
 * /v1/analyze returns span offsets as Python string indices (Unicode code points). JS strings index UTF-16 units,
 * so slice an Array.from(text) instead; otherwise an emoji before a span shifts every highlight.
 */
export function splitByCodepoints(text: string, spans: AnalyzeSpan[]): { text: string; span?: AnalyzeSpan }[] {
  const cps = Array.from(text);
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: { text: string; span?: AnalyzeSpan }[] = [];
  let at = 0;
  for (const s of sorted) {
    if (s.start < at) continue; // overlapping span; the server already resolved overlaps, keep the first
    if (s.start > at) out.push({ text: cps.slice(at, s.start).join('') });
    out.push({ text: cps.slice(s.start, s.end).join(''), span: s });
    at = s.end;
  }
  if (at < cps.length) out.push({ text: cps.slice(at).join('') });
  return out;
}

export type Outcome = 'block' | 'redact' | 'internal' | 'clean' | 'error';

/** One label for an audit row: what the gateway ended up doing with that request. */
export function outcomeOf(e: Pick<AuditEvent, 'status' | 'route' | 'findings'>): Outcome {
  if (e.status === 'blocked' || e.status === 'response_blocked') return 'block';
  if (e.status === 'upstream_error') return 'error';
  if (e.route === 'internal') return 'internal';
  if (e.findings.some((f) => f.action === 'redact' && f.count > 0)) return 'redact';
  return 'clean';
}

export const OUTCOME_BADGE: Record<Outcome, { cls: string; label: string }> = {
  block: { cls: 'b-block', label: 'BLOCKED' },
  redact: { cls: 'b-redact', label: 'REDACTED' },
  internal: { cls: 'b-internal', label: 'INTERNAL' },
  clean: { cls: 'b-clean', label: 'PASSED' },
  error: { cls: 'b-muted', label: 'ERROR' },
};

export const ACTION_KO: Record<string, string> = { redact: '가림', block: '차단', internal_only: '내부 처리', log: '기록만' };

export function findingsText(e: Pick<AuditEvent, 'findings'>): string {
  const req = e.findings.filter((f) => f.count > 0);
  if (!req.length) return '탐지 없음';
  return req.map((f) => (f.count > 1 ? `${f.label} ×${f.count}` : f.label)).join(' · ');
}

export const PROVIDER_KO: Record<string, string> = { mock: 'Mock LLM', openai: 'OpenAI', anthropic: 'Claude', internal: '내부 모델' };
export const providerName = (p: string): string => PROVIDER_KO[p] ?? p;
