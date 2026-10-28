// Lays /v1/stats/timeseries points onto fixed chart slots (hours of today or the last N days).
import type { TimeseriesPoint } from '../api/types';
import type { StackDatum } from '../components/charts';

export type Range = '24H' | '7D' | '30D';

const two = (n: number) => String(n).padStart(2, '0');
export const localYmd = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** Lay timeseries points onto fixed slots (hours of today, or the last N days). Empty slots stay 0. */
export function toSlots(points: TimeseriesPoint[], range: Range, now = new Date()): { data: StackDatum[]; x: string[] } {
  const stack = (p?: TimeseriesPoint): Omit<StackDatum, 'title'> => {
    if (!p) return { pass: 0, redact: 0, block: 0 };
    const block = p.blocked;
    // Redacted *requests* (older gateways only report items: cap those at the non-blocked requests, an approximation).
    const redact = Math.min(p.redacted_requests ?? p.redacted_items, Math.max(0, p.requests - block));
    return { block, redact, pass: Math.max(0, p.requests - block - redact) };
  };
  if (range === '24H') {
    const byHour = new Map<number, TimeseriesPoint>();
    for (const p of points) {
      const d = new Date(p.bucket);
      if (localYmd(d) === localYmd(now)) byHour.set(d.getHours(), p);
    }
    const data = Array.from({ length: 24 }, (_, h) => ({ title: `${two(h)}:00 – ${two(h + 1)}:00`, ...stack(byHour.get(h)) }));
    return { data, x: ['00시', '04', '08', '12', '16', '20', '24시'] };
  }
  const days = range === '7D' ? 7 : 30;
  const byDay = new Map(points.map((p) => [p.bucket.slice(0, 10), p]));
  const data: StackDatum[] = [];
  const labels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const label = `${two(d.getMonth() + 1)}.${two(d.getDate())}`;
    labels.push(label);
    data.push({ title: label, ...stack(byDay.get(localYmd(d))) });
  }
  const step = Math.max(1, Math.floor(days / 5));
  return { data, x: labels.filter((_, i) => i % step === 0 || i === days - 1) };
}

