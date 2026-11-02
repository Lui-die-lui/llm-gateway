// Hand-drawn charts (no chart library): axis ticks, baseline, hover/keyboard tooltip.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { niceTicks, smoothPath, spark, tipShift, type Pt } from '../features/chart';
import { fmt } from '../features/format';

interface TipRow {
  name: string;
  color: string;
  value: string;
}

function useCursor(n: number) {
  const [i, setI] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return;
    if (e.key === 'ArrowRight') setI((c) => Math.min(n - 1, c == null ? 0 : c + 1));
    else if (e.key === 'ArrowLeft') setI((c) => Math.max(0, c == null ? n - 1 : c - 1));
    else if (e.key === 'Home') setI(0);
    else if (e.key === 'End') setI(n - 1);
    else if (e.key === 'Escape') setI(null);
    else return;
    e.preventDefault();
  };
  return { i, setI, onKeyDown, onBlur: () => setI(null) };
}

function Tip({ left, shift, title, rows }: { left: string; shift: string; title: string; rows: TipRow[] }) {
  return (
    <div className="vz-tip" style={{ left, transform: `translateX(${shift})`, top: -4 }}>
      <div className="h">{title}</div>
      {rows.map((r) => (
        <div className="r" key={r.name}>
          <i className="vz-sw" style={{ background: r.color }} />
          <span>{r.name}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function Axis({ ticks, height, max }: { ticks: number[]; height: number; max: number }) {
  return (
    <div className="vz-y" style={{ height }} aria-hidden="true">
      {ticks.map((t) => (
        <span key={t} style={{ top: height - (t / max) * height }}>
          {fmt(t)}
        </span>
      ))}
    </div>
  );
}

function Grid({ ticks, height, max }: { ticks: number[]; height: number; max: number }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className={`vz-gl${t === 0 ? ' base' : ''}`} style={{ top: height - (t / max) * height }} />
      ))}
    </>
  );
}

const KEY_HINT = ' 왼쪽·오른쪽 화살표로 값을 볼 수 있어요.';

/* ------------------------------------------------------------------ stacked bars */

export interface StackDatum {
  title: string;
  pass: number;
  redact: number;
  block: number;
}

export function StackedBars({ data, xLabels, height = 220, aria, empty }: { data: StackDatum[]; xLabels: string[]; height?: number; aria: string; empty?: ReactNode }) {
  const cur = useCursor(data.length);
  const peak = Math.max(0, ...data.map((d) => d.pass + d.redact + d.block));
  const ticks = niceTicks(peak);
  const max = ticks[ticks.length - 1] || 1;
  const px = (v: number) => (v / max) * height;
  const hov = cur.i != null ? data[cur.i] : undefined;
  return (
    <div className="vz-plot" role="img" aria-label={aria + KEY_HINT} tabIndex={0} onKeyDown={cur.onKeyDown} onBlur={cur.onBlur}>
      <Axis ticks={ticks} height={height} max={max} />
      <div className="vz-area" style={{ height }} onMouseLeave={() => cur.setI(null)}>
        <Grid ticks={ticks} height={height} max={max} />
        {peak === 0 && <div className="vz-empty">{empty ?? '이 기간에 기록이 없어요'}</div>}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: data.length > 40 ? 1 : 4 }}>
          {data.map((d, i) => {
            const bH = px(d.block);
            return (
              <div
                key={i}
                onMouseEnter={() => cur.setI(i)}
                style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', opacity: cur.i == null || cur.i === i ? 1 : 0.38, transition: 'opacity .15s' }}
              >
                <div style={{ width: '72%', maxWidth: 18, display: 'flex', flexDirection: 'column', gap: d.block && d.redact ? 2 : 0 }}>
                  {bH > 0 && <i style={{ display: 'block', height: bH, background: 'var(--c-block)', borderRadius: '4px 4px 0 0' }} />}
                  {d.redact > 0 && <i style={{ display: 'block', height: px(d.redact), background: 'var(--c-redact)', borderRadius: bH ? 0 : '4px 4px 0 0' }} />}
                  <i style={{ display: 'block', height: px(d.pass), background: 'var(--c-pass)', borderRadius: bH || d.redact ? 0 : '4px 4px 0 0' }} />
                </div>
              </div>
            );
          })}
        </div>
        {hov && cur.i != null && (
          <Tip
            left={`${(((cur.i + 0.5) / data.length) * 100).toFixed(2)}%`}
            shift={tipShift(cur.i, data.length)}
            title={`${hov.title} · ${fmt(hov.pass + hov.redact + hov.block)}건`}
            rows={[
              { name: '차단', color: 'var(--c-block)', value: fmt(hov.block) },
              { name: '가림', color: 'var(--c-redact)', value: fmt(hov.redact) },
              { name: '통과', color: 'var(--c-pass)', value: fmt(hov.pass) },
            ]}
          />
        )}
      </div>
      <div className="vz-x" aria-hidden="true">
        {xLabels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ lines */

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
  area?: boolean;
}

export interface LineAnnotation {
  index: number;
  value: number;
  text: string;
}

export function LineChart({
  series,
  xLabels,
  height = 180,
  aria,
  titleAt,
  annotation,
  yMax,
}: {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  aria: string;
  titleAt: (i: number) => string;
  annotation?: LineAnnotation;
  yMax?: number;
}) {
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const cur = useCursor(n);
  const peak = yMax ?? Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(peak);
  const max = ticks[ticks.length - 1] || 1;
  const W = 900;
  const y = (v: number) => height - (v / max) * height;
  const x = (i: number) => (n > 1 ? (i * W) / (n - 1) : W / 2);
  const xPct = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const gid = `g${series.map((s) => s.color).join('').replace(/[^a-z0-9]/gi, '')}`;
  return (
    <div className="vz-plot" role="img" aria-label={aria + KEY_HINT} tabIndex={0} onKeyDown={cur.onKeyDown} onBlur={cur.onBlur}>
      <Axis ticks={ticks} height={height} max={max} />
      <div className="vz-area" style={{ height }} onMouseLeave={() => cur.setI(null)}>
        <Grid ticks={ticks} height={height} max={max} />
        {n === 0 && <div className="vz-empty">이 기간에 기록이 없어요</div>}
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height, overflow: 'visible' }} aria-hidden="true">
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${gid}-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity=".2" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {series.map((s, k) => {
            if (s.values.length < 1) return null;
            const d = smoothPath(s.values.map((v, i) => [x(i), y(v)] as Pt));
            return (
              <g key={s.name}>
                {s.area && <path d={`${d} L${x(s.values.length - 1)} ${height} L0 ${height} Z`} fill={`url(#${gid}-${k})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '5 5' : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
        {annotation && n > 0 && (
          <>
            <div style={{ position: 'absolute', left: `${xPct(annotation.index)}%`, top: y(annotation.value), transform: 'translate(-50%,-50%)', width: 10, height: 10, borderRadius: '50%', background: 'var(--c-block)', boxShadow: '0 0 0 3px #fff,0 0 0 6px rgba(227,73,72,.2)' }} />
            <div style={{ position: 'absolute', left: `${xPct(annotation.index)}%`, top: Math.max(-6, y(annotation.value) - 36), transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, color: 'var(--danger)', background: '#fff', border: '1px solid rgba(227,73,72,.3)', borderRadius: 999, padding: '3px 9px' }}>
              {annotation.text}
            </div>
          </>
        )}
        {cur.i != null && n > 0 && (
          <>
            <div className="vz-cursor" style={{ left: `${xPct(cur.i)}%` }} />
            {series.map((s) =>
              s.values[cur.i!] == null ? null : <div key={s.name} className="vz-dot" style={{ left: `${xPct(cur.i!)}%`, top: y(s.values[cur.i!] as number), background: s.color }} />,
            )}
            <Tip
              left={`${xPct(cur.i).toFixed(2)}%`}
              shift={tipShift(cur.i, n)}
              title={titleAt(cur.i)}
              rows={series.map((s) => ({ name: s.name, color: s.color, value: fmt(Math.round(s.values[cur.i!] ?? 0)) }))}
            />
          </>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} style={{ flex: 1 }} onMouseEnter={() => cur.setI(i)} />
          ))}
        </div>
      </div>
      <div className="vz-x" aria-hidden="true">
        {xLabels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sparkline / ranked bars */

export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const s = spark(values);
  return (
    <svg viewBox="0 0 120 36" preserveAspectRatio="none" style={{ width: 110, height: 36, flex: '0 0 auto' }} aria-hidden="true">
      <path d={s.area} fill={color} fillOpacity={0.12} />
      <path d={s.line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={s.ex} cy={s.ey} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

export interface RankItem {
  name: string;
  tag?: string;
  value: number;
  color: string;
}

export function RankBars({ items, limit = 6 }: { items: RankItem[]; limit?: number }) {
  const top = items.slice(0, limit);
  const total = items.reduce((a, b) => a + b.value, 0);
  const peak = Math.max(1, ...top.map((t) => t.value));
  if (!top.length) return <div className="empty">아직 찾은 정보가 없어요</div>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {top.map((t, i) => (
        <li key={t.name + i} className="vz-hbar">
          <span className="rk">{i + 1}</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
            <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
            {t.tag && <span style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>{t.tag}</span>}
          </span>
          <span className="vz-num">
            {fmt(t.value)}
            <small>{total ? Math.round((t.value / total) * 100) : 0}%</small>
          </span>
          <span />
          <div className="vz-track" style={{ gridColumn: '2 / 4' }}>
            <i style={{ width: `${Math.round((t.value / peak) * 100)}%`, background: t.color }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
