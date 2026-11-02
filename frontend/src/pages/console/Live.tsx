// 02 실시간 모니터링 (Live.dc.html). Event stream = /v1/audit/events polled at the chosen interval.
// The per-minute chart is real (/v1/stats/timeseries?bucket=minute). Anomalies are mocks: the gateway has no anomaly detection.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { gateway } from '../../api/gateway';
import type { Anomaly } from '../../api/consoleTypes';
import { MockBadge, Seg } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { LineChart } from '../../components/charts';
import { useFeedback } from '../../features/feedback';
import { findingsText, hms, OUTCOME_BADGE, outcomeOf, providerName } from '../../features/format';
import { qk } from '../../features/queries';

type Refresh = '5s' | '30s' | 'off';
const REFRESH = [
  ['5s', '5초'],
  ['30s', '30초'],
  ['off', '일시정지'],
] as const;
const MS: Record<Refresh, number | false> = { '5s': 5000, '30s': 30000, off: false };
const SEV_CLS: Record<Anomaly['sev'], string> = { HIGH: 'b-block', MEDIUM: 'b-redact', LOW: 'b-muted' };

export function LivePage() {
  const [refresh, setRefresh] = useState<Refresh>('5s');
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useFeedback();
  const interval = MS[refresh];

  const minutes = useQuery({ queryKey: qk.minutes, queryFn: consoleApi.minuteSeries, refetchInterval: interval });
  const stream = useQuery({ queryKey: qk.audit({ limit: 8, live: true }), queryFn: () => gateway.auditEvents({ limit: 8 }), refetchInterval: interval });
  const anomalies = useQuery({ queryKey: qk.anomalies, queryFn: consoleApi.anomalies });

  const act = useMutation({
    mutationFn: ({ a, kind }: { a: Anomaly; kind: 'ack' | 'primary' }) => consoleApi.ackAnomaly(a.id, kind),
    onSuccess: (_, { a, kind }) => {
      qc.invalidateQueries({ queryKey: qk.anomalies });
      qc.invalidateQueries({ queryKey: qk.adminLog });
      if (kind === 'ack') toast('이상 징후를 확인 처리했습니다');
      else if (a.primaryHref) nav(a.primaryHref);
      else toast(`‘${a.primary}’ 처리했어요 · 관리자 작업에 기록`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const m = minutes.data ?? [];
  const last = m[m.length - 1];
  const avg = m.length ? Math.round(m.reduce((a, p) => a + p.total, 0) / m.length) : 0;
  const spikeIdx = m.reduce((best, p, i) => (p.block > (m[best]?.block ?? -1) ? i : best), 0);
  const spike = m[spikeIdx];
  const open = (anomalies.data ?? []).filter((a) => !a.acked);
  const step = Math.max(1, Math.floor(m.length / 5));

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">모니터 / 실시간</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <h1 style={{ margin: 0 }}>실시간 모니터링</h1>
            <span className="badge b-block">LIVE · {refresh === 'off' ? '일시정지' : `${refresh} 갱신`}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Seg label="자동 새로고침" options={REFRESH} value={refresh} onChange={setRefresh} />
          <Link className="btn" to="/console/settings">
            알림 규칙
          </Link>
        </div>
      </header>

      <section className="card vz vz-card">
        <div className="vz-head">
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <h2 className="vz-title">분당 전송 · 최근 60분</h2>
            </div>
            <div className="vz-hero">
              <b>{last?.total ?? '—'}</b>
              <span>건/분 지금 · 평균 {avg}건</span>
            </div>
          </div>
          <div className="vz-leg">
            {[
              ['전체', 'var(--c-total)', last?.total],
              ['가림', 'var(--c-redact)', last?.redact],
              ['차단', 'var(--c-block)', last?.block],
            ].map(([n, c, v]) => (
              <div key={n as string}>
                <span>
                  <i className="vz-swl" style={{ background: c as string }} />
                  {n}
                </span>
                <b>{(v as number | undefined) ?? '—'}</b>
              </div>
            ))}
          </div>
        </div>
        <QueryState isLoading={minutes.isLoading} error={minutes.error} />
        {m.length > 0 && (
          <LineChart
            height={220}
            yMax={Math.max(10, ...m.map((p) => p.total))}
            aria={`최근 60분 분당 전송 수. 평균 ${avg}건, ${spike?.t ?? ''} 차단이 ${spike?.block ?? 0}건으로 가장 많아요.`}
            series={[
              { name: '전체', color: '#64748B', values: m.map((p) => p.total), area: true },
              { name: '가림', color: '#2a78d6', values: m.map((p) => p.redact) },
              { name: '차단', color: '#e34948', values: m.map((p) => p.block) },
            ]}
            xLabels={m.filter((_, i) => i % step === 0 || i === m.length - 1).map((p) => p.t)}
            titleAt={(i) => m[i]?.t ?? ''}
            annotation={spike && spike.block > 20 ? { index: spikeIdx, value: spike.block, text: `${spike.t} 차단 ${spike.block}건` } : undefined}
          />
        )}
      </section>

      <div className="row-wrap">
        <section className="card" style={{ flex: '2 1 560px' }}>
          <div className="ch">
            <h2 className="ct">이벤트 스트림</h2>
            <span className="t3" style={{ fontSize: 12 }}>
              메타데이터만 표시 · 원문 미보관
            </span>
          </div>
          <QueryState isLoading={stream.isLoading} error={stream.error} onRetry={() => stream.refetch()} />
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }} aria-live={refresh === 'off' ? 'off' : 'polite'}>
            {stream.data?.length === 0 && <li className="empty">아직 기록이 없어요</li>}
            {stream.data?.map((e) => {
              const b = OUTCOME_BADGE[outcomeOf(e)];
              return (
                <li key={e.id} style={{ display: 'grid', gridTemplateColumns: '72px 92px minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 13 }}>
                  <span className="mono t3" style={{ fontSize: 12 }}>
                    {hms(e.ts)}
                  </span>
                  <span className="chip mono" style={{ justifyContent: 'center' }} title={e.endpoint}>
                    {e.endpoint.replace('/v1/', '')}
                  </span>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b style={{ fontWeight: 500 }} title={e.industries || undefined}>{e.industries ? e.industries.split(',').map((x) => x.trim()).join(', ') : '기본 규칙'}</b>
                    <span className="t2">
                      {' '}
                      → {providerName(e.provider)} · {findingsText(e)}
                    </span>
                  </span>
                  <span className={`badge ${b.cls}`}>{b.label}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="card" style={{ flex: '1 1 340px' }}>
          <div className="ch">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <h2 className="ct">이상 징후</h2>
              <MockBadge />
            </div>
            <span className={`badge ${open.length ? 'b-block' : 'b-clean'}`}>{open.length} OPEN</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {open.length === 0 && anomalies.data && <div className="empty">열린 이상 징후가 없어요</div>}
            {open.map((a) => (
              <article key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', background: 'rgba(255,255,255,.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${SEV_CLS[a.sev]}`}>{a.sev}</span>
                  <span className="mono t3" style={{ fontSize: 11 }}>
                    {a.t}
                  </span>
                </div>
                <h3 style={{ margin: '8px 0 4px', fontSize: 13.5, fontWeight: 600 }}>{a.title}</h3>
                <p className="t2" style={{ margin: 0, fontSize: 12, lineHeight: 1.55 }}>
                  {a.desc}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => act.mutate({ a, kind: 'primary' })}>
                    {a.primary}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => act.mutate({ a, kind: 'ack' })}>
                    확인 처리
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
