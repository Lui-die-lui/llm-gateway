// 01 개요 (Main.dc.html). Numbers and charts come from /v1/stats/*, the event table from /v1/audit/events.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { gateway } from '../../api/gateway';
import type { StatsSummary } from '../../api/types';
import { toSlots, localYmd, type Range } from '../../features/slots';
import { Seg } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { RankBars, Sparkline, StackedBars, type RankItem } from '../../components/charts';
import { useAuth } from '../../features/auth';
import { compare, daysAgo, findingsText, fmt, fmtMs, hms, OUTCOME_BADGE, outcomeOf, pct, providerName, startOfToday } from '../../features/format';
import { qk, usePendingCounts } from '../../features/queries';
import { useLabelCategory } from '../../features/catalog';

const RANGES = [
  ['24H', '24H'],
  ['7D', '7D'],
  ['30D', '30D'],
] as const;

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 11 ? '좋은 아침이에요' : h < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
}

function blockedOf(s?: StatsSummary): number {
  return (s?.by_status.blocked ?? 0) + (s?.by_status.response_blocked ?? 0);
}

export function OverviewPage() {
  const [range, setRange] = useState<Range>('24H');
  const [search, setSearch] = useState('');
  const nav = useNavigate();
  const { session } = useAuth();
  const counts = usePendingCounts();
  const category = useLabelCategory();

  const days = range === '24H' ? 1 : range === '7D' ? 7 : 30;
  const since = range === '24H' ? startOfToday() : daysAgo(days - 1);
  // Like with like: today so far against yesterday up to the same time; a week or a month against the period right before it.
  const nowMinute = Math.floor(Date.now() / 60_000) * 60;
  const prevFrom = range === '24H' ? startOfToday() - 86400 : since - days * 86400;
  const prevUntil = range === '24H' ? nowMinute - 86400 : since;

  const cur = useQuery({ queryKey: qk.summary(since), queryFn: () => gateway.summary(since), refetchInterval: 30_000 });
  const prevQ = useQuery({ queryKey: qk.summary(prevFrom, prevUntil), queryFn: () => gateway.summary(prevFrom, prevUntil), refetchInterval: 60_000 });
  const series = useQuery({
    queryKey: qk.timeseries(range === '24H' ? 'hour' : 'day', since),
    queryFn: () => gateway.timeseries(range === '24H' ? 'hour' : 'day', since),
    refetchInterval: 30_000,
  });
  const spark14 = useQuery({ queryKey: qk.timeseries('day', daysAgo(13)), queryFn: () => gateway.timeseries('day', daysAgo(13)) });
  const events = useQuery({ queryKey: qk.audit({ limit: 6 }), queryFn: () => gateway.auditEvents({ limit: 6 }), refetchInterval: 10_000 });

  const s = cur.data;
  const pd = prevQ.data;
  const prev = pd ? { requests: pd.requests, redacted: pd.redacted_items, blocked: blockedOf(pd) } : null;

  const sparkVals = useMemo(() => {
    const pts = spark14.data ?? [];
    const byDay = new Map(pts.map((p) => [p.bucket.slice(0, 10), p]));
    const out = { requests: [] as number[], redacted: [] as number[], blocked: [] as number[] };
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const p = byDay.get(localYmd(d));
      out.requests.push(p?.requests ?? 0);
      out.redacted.push(p?.redacted_items ?? 0);
      out.blocked.push(p?.blocked ?? 0);
    }
    return out;
  }, [spark14.data]);

  const slots = useMemo(() => toSlots(series.data ?? [], range), [series.data, range]);
  const sums = slots.data.reduce((a, d) => ({ pass: a.pass + d.pass, redact: a.redact + d.redact, block: a.block + d.block }), { pass: 0, redact: 0, block: 0 });
  const total = sums.pass + sums.redact + sums.block;

  const types: RankItem[] = useMemo(() => {
    const m = new Map<string, { value: number; block: boolean }>();
    for (const f of s?.findings ?? []) {
      if (f.direction !== 'request') continue;
      const e = m.get(f.label) ?? { value: 0, block: false };
      e.value += f.count;
      e.block ||= f.action === 'block';
      m.set(f.label, e);
    }
    return [...m.entries()].sort((a, b) => b[1].value - a[1].value).map(([name, v]) => ({ name, tag: category(name), value: v.value, color: v.block ? 'var(--c-block)' : 'var(--c-redact)' }));
  }, [s, category]);
  const typeTotal = types.reduce((a, t) => a + t.value, 0);

  const blockedTop = (s?.findings ?? []).filter((f) => f.action === 'block').slice(0, 2).map((f) => f.label).join(' · ');
  const periodWord = range === '24H' ? '오늘' : `최근 ${days}일`;
  const vsWord = range === '24H' ? '어제 같은 시각 대비' : '직전 기간 대비';

  const kpis = [
    { label: '검사한 프롬프트', value: s?.requests, d: prev && s ? compare(s.requests, prev.requests) : null, color: '#64748B', cap: `${vsWord} · 14일 추이`, spark: sparkVals.requests, goodDown: false },
    { label: '가림 처리', value: s?.redacted_items, d: prev && s ? compare(s.redacted_items, prev.redacted) : null, color: 'var(--c-redact)', cap: s ? `가린 항목 · 프롬프트 ${fmt(s.requests)}건 중` : '가린 항목', spark: sparkVals.redacted, goodDown: false },
    { label: '전송 차단', value: s ? blockedOf(s) : undefined, d: prev && s ? compare(blockedOf(s), prev.blocked) : null, color: 'var(--c-block)', cap: blockedTop || '차단 없음', spark: sparkVals.blocked, goodDown: true },
  ];

  const name = session?.user.name ?? '보안관리자';

  return (
    <>
      <header className="page-head">
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>
            {greeting()}, {name}님
          </h1>
          <div className="t2" style={{ fontSize: 13.5, marginTop: 4 }}>
            {periodWord} AI로 보낸 프롬프트 현황이에요
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Seg label="기간" mono options={RANGES} value={range} onChange={setRange} />
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              nav(`/console/logs?q=${encodeURIComponent(search)}`);
            }}
          >
            <label className="sr-only" htmlFor="ov-search">
              검색
            </label>
            <input id="ov-search" className="in" style={{ width: 240 }} placeholder="사용자, 유형, 정책 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <Link className="btn btn-p" to="/console/policy">
            정책 배포
          </Link>
        </div>
      </header>

      <section aria-label="주의 필요" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { tag: `PENDING ${counts.exceptions}`, cls: 'b-accent', text: `예외 요청 ${counts.exceptions}건이 관리자 결정을 기다려요`, to: '/console/exceptions', show: counts.exceptions > 0 },
          { tag: `이상 징후 ${counts.anomalies}`, cls: 'b-block', text: `확인하지 않은 이상 징후 ${counts.anomalies}건이 있어요`, to: '/console/live', show: counts.anomalies > 0 },
        ]
          .filter((a) => a.show)
          .map((a) => (
            <Link key={a.to + a.tag} to={a.to} style={{ flex: '1 1 260px', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.55)', border: '1px solid var(--line)', textDecoration: 'none', color: 'var(--ink)' }}>
              <span className={`badge ${a.cls}`}>{a.tag}</span>
              <span style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{a.text}</span>
              <span className="t3" style={{ fontSize: 13 }} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
      </section>

      {cur.error ? <QueryState error={cur.error} onRetry={() => cur.refetch()} /> : null}

      <section aria-label="핵심 지표" className="vz" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 16 }}>
        {kpis.map((k) => {
          const dStyle = !k.d ? { background: 'rgba(15,26,43,.06)', color: 'var(--ink-3)' } : (k.d.dir === 'down') === k.goodDown ? { background: 'rgba(16,185,129,.12)', color: '#047857' } : { background: 'rgba(15,26,43,.06)', color: 'var(--ink)' };
          return (
            <div key={k.label} className="card vz-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{k.label}</span>
                <span className="mono" title={k.d ? undefined : '비교할 이전 기록이 5건 미만이라 변화율은 표시하지 않아요'} style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, ...dStyle }}>
                  {k.d?.text ?? '비교 없음'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
                <div>
                  <div className="mono" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.1 }}>
                    {cur.isLoading ? '…' : fmt(k.value)}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 4 }}>{k.cap}</div>
                </div>
                <Sparkline values={k.spark} color={k.color} />
              </div>
            </div>
          );
        })}
        <div className="card vz-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>확인 대기</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'rgba(217,119,6,.12)', color: '#92400E' }}>
              예외 {counts.exceptions} · 이상 징후 {counts.anomalies}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
            <div>
              <div className="mono" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.1 }}>
                {counts.anomalies + counts.exceptions}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 4 }}>보안 관리자 처리 필요</div>
            </div>
          </div>
        </div>
      </section>

      <div className="vz row-wrap">
        <section className="card vz-card" style={{ flex: '2 1 560px' }}>
          <div className="vz-head">
            <div>
              <h2 className="vz-title">{periodWord} AI로 보낸 프롬프트 · {range === '24H' ? '시간대별' : '일별'}</h2>
              <div className="vz-hero">
                <b>{fmt(total)}</b>
                <span>
                  건 · 가림 {pct(sums.redact, total)} · 차단 {fmt(sums.block)}건
                </span>
              </div>
            </div>
            <div className="vz-leg">
              {[
                ['통과', 'var(--c-pass)', sums.pass],
                ['가림', 'var(--c-redact)', sums.redact],
                ['차단', 'var(--c-block)', sums.block],
              ].map(([n, c, v]) => (
                <div key={n as string}>
                  <span>
                    <i className="vz-sw" style={{ background: c as string }} />
                    {n}
                  </span>
                  <b>{fmt(v as number)}</b>
                </div>
              ))}
            </div>
          </div>
          {series.error ? (
            <QueryState error={series.error} onRetry={() => series.refetch()} />
          ) : (
            <StackedBars data={slots.data} xLabels={slots.x} aria={`${periodWord} ${range === '24H' ? '시간대별' : '일별'} 통과, 가림, 차단 건수. 전체 ${fmt(total)}건.`} />
          )}
        </section>

        <section className="card vz-card" style={{ flex: '1 1 340px' }}>
          <div className="vz-head" style={{ marginBottom: 10 }}>
            <div>
              <h2 className="vz-title">많이 찾은 정보 종류</h2>
              <div className="vz-hero">
                <b>{fmt(typeTotal)}</b>
                <span>건 · {periodWord}</span>
              </div>
            </div>
          </div>
          <RankBars items={types} />
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>
            막대 색: <span style={{ color: 'var(--c-redact)', fontWeight: 600 }}>파랑</span> 가림 · <span style={{ color: '#c53a3a', fontWeight: 600 }}>빨강</span> 차단 규칙
          </p>
        </section>
      </div>

      <section className="card">
        <div className="ch">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <h2 className="ct">실시간 이벤트</h2>
            <span className="badge b-block">LIVE</span>
          </div>
          <Link to="/console/logs" style={{ fontSize: 13.5 }}>
            전체 로그 →
          </Link>
        </div>
        <QueryState isLoading={events.isLoading} error={events.error} onRetry={() => events.refetch()} />
        {events.data && (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>USER</th>
                  <th>TARGET</th>
                  <th>DETECTED</th>
                  <th>ACTION</th>
                  <th className="num">LAT</th>
                </tr>
              </thead>
              <tbody>
                {events.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">
                      아직 기록이 없어요 · 게이트웨이로 요청을 보내면 여기에 보여요
                    </td>
                  </tr>
                )}
                {events.data.map((e) => {
                  const b = OUTCOME_BADGE[outcomeOf(e)];
                  return (
                    <tr key={e.id}>
                      <td className="mono t3" style={{ fontSize: 13 }}>
                        {hms(e.ts)}
                      </td>
                      <td className="t3" title={e.caller ? '호출한 앱 (API 키 이름)' : '키를 쓰지 않았거나 사용자가 아직 없어요'}>
                        {e.caller ?? '—'}
                      </td>
                      <td>
                        <span className="chip mono">{providerName(e.provider)}</span>
                      </td>
                      <td className="t2">{findingsText(e)}</td>
                      <td>
                        <span className={`badge ${b.cls}`}>{b.label}</span>
                      </td>
                      <td className="mono t3 num" style={{ fontSize: 13 }}>
                        {fmtMs(e.latency_ms)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
