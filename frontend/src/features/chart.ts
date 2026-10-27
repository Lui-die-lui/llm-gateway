// Small helpers for the hand-drawn SVG charts.

export type Pt = [number, number];

/** Smooth path through points (horizontal-tangent cubic, same curve the design uses). */
export function smoothPath(pts: Pt[]): string {
  return pts
    .map((p, i) => {
      if (i === 0) return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      const q = pts[i - 1] as Pt;
      const cx = (q[0] + p[0]) / 2;
      return `C${cx.toFixed(1)} ${q[1].toFixed(1)} ${cx.toFixed(1)} ${p[1].toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    })
    .join(' ');
}

/** Round axis maximum and evenly spaced ticks (4 intervals) that cover `max`. */
export function niceTicks(max: number, intervals = 4): number[] {
  if (!(max > 0)) return Array.from({ length: intervals + 1 }, (_, i) => i);
  const rough = max / intervals;
  const mag = 10 ** Math.floor(Math.log10(rough));
  // Counts only: never step below 1 (no "2.5건" ticks).
  const step = Math.max(1, Math.ceil([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag));
  return Array.from({ length: intervals + 1 }, (_, i) => Math.round(i * step * 1000) / 1000);
}

/** Sparkline geometry in a 120×36 box. */
export function spark(vals: number[], W = 120, H = 36, pad = 4) {
  const safe = vals.length > 1 ? vals : [vals[0] ?? 0, vals[0] ?? 0];
  const mx = Math.max(...safe);
  const mn = Math.min(...safe);
  const pts: Pt[] = safe.map((v, i) => [(i * W) / (safe.length - 1), pad + (H - 2 * pad) * (1 - (v - mn) / (mx - mn || 1))]);
  const line = smoothPath(pts);
  const end = pts[pts.length - 1] as Pt;
  return { line, area: `${line} L${W} ${H} L0 ${H} Z`, ex: end[0], ey: end[1] };
}

/** Tooltip horizontal anchoring so it never leaves the plot. */
export function tipShift(i: number, n: number): string {
  if (i < n * 0.15) return '8px';
  if (i > n * 0.85) return 'calc(-100% - 8px)';
  return '-50%';
}
