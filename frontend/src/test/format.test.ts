import { describe, expect, it } from 'vitest';
import { delta, outcomeOf, splitByCodepoints } from '../features/format';
import { niceTicks } from '../features/chart';
import { toSlots } from '../features/slots';

describe('splitByCodepoints', () => {
  it('slices by code points so an emoji before a span does not shift it', () => {
    // Python indices: "😀 고객 홍길동" -> 홍길동 at 5..8 (the emoji is one code point, two UTF-16 units)
    const text = '😀 고객 홍길동 메일';
    const parts = splitByCodepoints(text, [{ start: 5, end: 8, label: '사람', action: 'redact' }]);
    expect(parts.map((p) => p.text)).toEqual(['😀 고객 ', '홍길동', ' 메일']);
    expect(parts[1]?.span?.label).toBe('사람');
  });

  it('keeps text order and skips overlapping spans', () => {
    const parts = splitByCodepoints('abcdef', [
      { start: 3, end: 5, label: 'B', action: 'redact' },
      { start: 0, end: 2, label: 'A', action: 'block' },
      { start: 1, end: 4, label: 'X', action: 'redact' },
    ]);
    expect(parts.map((p) => [p.text, p.span?.label])).toEqual([
      ['ab', 'A'],
      ['c', undefined],
      ['de', 'B'],
      ['f', undefined],
    ]);
  });
});

describe('outcomeOf', () => {
  const ev = (o: Partial<Parameters<typeof outcomeOf>[0]>) => ({ status: 'ok' as const, route: 'external', findings: [], ...o });
  it('maps audit rows to one badge', () => {
    expect(outcomeOf(ev({ status: 'blocked' }))).toBe('block');
    expect(outcomeOf(ev({ status: 'response_blocked' }))).toBe('block');
    expect(outcomeOf(ev({ route: 'internal' }))).toBe('internal');
    expect(outcomeOf(ev({ findings: [{ direction: 'request', label: '이메일', action: 'redact', count: 1 }] }))).toBe('redact');
    expect(outcomeOf(ev({}))).toBe('clean');
    expect(outcomeOf(ev({ status: 'upstream_error' }))).toBe('error');
  });
});

describe('chart helpers', () => {
  it('niceTicks covers the max with integer steps', () => {
    expect(niceTicks(10)).toEqual([0, 3, 6, 9, 12]);
    const t = niceTicks(1834);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1834);
    expect(niceTicks(3).every((v) => Number.isInteger(v))).toBe(true);
  });

  it('delta reports direction and is null without a base', () => {
    expect(delta(110, 100)).toEqual({ text: '+10.0%', dir: 'up' });
    expect(delta(90, 100)?.dir).toBe('down');
    expect(delta(5, 0)).toBeNull();
  });

  it('toSlots stacks blocked / redacted / passed and never goes negative', () => {
    const now = new Date(2026, 9, 27, 15, 0, 0);
    const bucket = new Date(2026, 9, 27, 10, 0, 0).toISOString();
    const { data, x } = toSlots([{ bucket, requests: 10, blocked: 2, redacted_items: 30 }], '24H', now);
    expect(data).toHaveLength(24);
    expect(x[0]).toBe('00시');
    expect(data[10]).toMatchObject({ block: 2, redact: 8, pass: 0 });
    expect(data[9]).toMatchObject({ block: 0, redact: 0, pass: 0 });
  });
});
