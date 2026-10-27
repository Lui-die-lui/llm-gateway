// 04 분석 리포트 (Reports.dc.html).
// Real: totals and daily lines (/v1/stats/*), info-type totals (summary.findings), rule accuracy (/v1/eval),
//       redaction rate and p95 latency sampled from the latest 500 audit events.
// Mock: false-positive rate, department heatmap, training candidates + Slack, scheduled reports.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { gateway } from '../../api/gateway';
import type { TimeseriesPoint } from '../../api/types';
import { MockBadge, Seg } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { QueryState } from '../../components/QueryState';
import { LineChart, RankBars, type RankItem } from '../../components/charts';
import { industryName, useLabelCategory } from '../../features/catalog';
import { useFeedback } from '../../features/feedback';
import { daysAgo, fmt } from '../../features/format';
import { qk, useSettings } from '../../features/queries';

type Range = '7D' | '30D' | '90D' | 'Q';
const RANGES = [
  ['7D', '7D'],
  ['30D', '30D'],
  ['90D', '90D'],
  ['Q', '분기'],
] as const;

const two = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const md = (d: Date) => `${two(d.getMonth() + 1)}.${two(d.getDate())}`;

function rangeDays(r: Range, now = new Date()): number {
  if (r === '7D') return 7;
  if (r === '30D') return 30;
  if (r === '90D') return 90;
  const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  return Math.floor((now.getTime() - qStart.getTime()) / 86400000) + 1;
}

function daily(points: TimeseriesPoint[], days: number, offsetDays: number, pick: (p?: TimeseriesPoint) => number): number[] {
  const by = new Map(points.map((p) => [p.bucket.slice(0, 10), p]));
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i - offsetDays);
    out.push(pick(by.get(ymd(d))));
  }
  return out;
}

const RAMP = ['var(--ramp-1)', 'var(--ramp-2)', 'var(--ramp-3)', 'var(--ramp-4)', 'var(--ramp-5)'];
const bin = (v: number) => (v < 50 ? 0 : v < 150 ? 1 : v < 300 ? 2 : v < 450 ? 3 : 4);
const SLACK_MSG = '[이름]님, 안녕하세요. 정보보호팀이에요.\n오늘 AI에 보낸 글에서 [정보 종류]이(가) [n]번 막혔어요.\n막힌 부분은 지우거나 "[API 키]"처럼 바꿔서 보내 주세요. 업무상 꼭 필요하면 확장에서 예외 요청을 보낼 수 있어요.';

export function ReportsPage() {
  const [range, setRange] = useState<Range>('30D');
  const [preview, setPreview] = useState(false);
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const category = useLabelCategory();
  const settings = useSettings();

  const days = rangeDays(range);
  const since = daysAgo(days - 1);
  const prevSince = daysAgo(days * 2 - 1);
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days + 1);

  const cur = useQuery({ queryKey: qk.summary(since), queryFn: () => gateway.summary(since) });
  const both = useQuery({ queryKey: qk.summary(prevSince), queryFn: () => gateway.summary(prevSince) });
  const ts = useQuery({ queryKey: qk.timeseries('day', prevSince), queryFn: () => gateway.timeseries('day', prevSince) });
  const sample = useQuery({ queryKey: qk.audit({ limit: 500 }), queryFn: () => gateway.auditEvents({ limit: 500 }) });
  const evalReport = useQuery({ queryKey: qk.evalReport, queryFn: gateway.evalReport, staleTime: 5 * 60_000 });
  const heat = useQuery({ queryKey: qk.heatmap, queryFn: consoleApi.deptHeatmap });
  const cands = useQuery({ queryKey: qk.candidates, queryFn: consoleApi.trainingCandidates });
  const sched = useQuery({ queryKey: qk.schedules, queryFn: consoleApi.schedules });

  const send = useMutation({
    mutationFn: (id: string) => consoleApi.sendSlack(id),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: qk.candidates });
      qc.invalidateQueries({ queryKey: qk.adminLog });
      toast(`${c.user}님에게 Slack 메시지를 보냈어요 · 관리자 작업에 기록`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const s = cur.data;
  const prev = both.data && s ? { requests: both.data.requests - s.requests, blocked: (both.data.by_status.blocked ?? 0) - (s.by_status.blocked ?? 0) } : null;
  const blocked = s?.by_status.blocked ?? 0;
  const blockRate = s?.requests ? (blocked / s.requests) * 100 : null;
  const prevBlockRate = prev?.requests ? (prev.blocked / prev.requests) * 100 : null;

  const sampleStats = useMemo(() => {
    const ev = (sample.data ?? []).filter((e) => e.ts >= since);
    if (!ev.length) return null;
    const red = ev.filter((e) => e.findings.some((f) => f.direction === 'request' && f.action === 'redact' && f.count > 0)).length;
    const lat = ev.map((e) => e.latency_ms ?? 0).sort((a, b) => a - b);
    return { n: ev.length, redactRate: (red / ev.length) * 100, p95: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] ?? 0 };
  }, [sample.data, since]);

  const blockTop = (s?.findings ?? []).filter((f) => f.action === 'block').slice(0, 2);
  const blockTotal = (s?.findings ?? []).filter((f) => f.action === 'block').reduce((a, f) => a + f.count, 0);

  const pts = ts.data ?? [];
  const rCur = daily(pts, days, 0, (p) => p?.redacted_items ?? 0);
  const rPrev = daily(pts, days, days, (p) => p?.redacted_items ?? 0);
  const bCur = daily(pts, days, 0, (p) => p?.blocked ?? 0);
  const bPrev = daily(pts, days, days, (p) => p?.blocked ?? 0);
  const avg = (a: number[]) => {
    const v = a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  };
  const dayAt = (i: number) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return md(d);
  };
  const xLabels = Array.from({ length: 5 }, (_, k) => dayAt(Math.round((k * (days - 1)) / 4)));

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

  const hm = heat.data;
  const hmMax = hm ? hm.rows.flatMap((r) => r.values.map((v, i) => ({ v, where: `${r.dept} · ${hm.cols[i]}` }))).sort((a, b) => b.v - a.v)[0] : undefined;

  const okStyle = { background: 'rgba(16,185,129,.12)', color: '#047857' };
  const neutral = { background: 'rgba(15,26,43,.06)', color: 'var(--ink)' };
  const dpct = (a: number | null, b: number | null) => (a == null || b == null ? null : `${a - b >= 0 ? '+' : ''}${(a - b).toFixed(1)}p`);
  const reqDelta = prev?.requests && s ? `${s.requests >= prev.requests ? '+' : ''}${Math.round(((s.requests - prev.requests) / prev.requests) * 100)}%` : null;

  const kpis = [
    { label: '검사한 프롬프트', value: fmt(s?.requests), delta: reqDelta, ds: neutral, note: s ? `하루 평균 ${fmt(Math.round((s.requests / days) * 10) / 10)}` : '…' },
    { label: '가림률', value: sampleStats ? `${sampleStats.redactRate.toFixed(1)}%` : '—', delta: null, ds: neutral, note: sampleStats ? `1건 이상 가린 전송 비율 · 최근 ${sampleStats.n}건 기준` : '1건 이상 가린 전송 비율' },
    { label: '차단률', value: blockRate == null ? '—' : `${blockRate.toFixed(1)}%`, delta: dpct(blockRate, prevBlockRate), ds: blockRate != null && prevBlockRate != null && blockRate <= prevBlockRate ? okStyle : neutral, note: blockTop.length ? blockTop.map((f) => `${f.label} ${Math.round((f.count / (blockTotal || 1)) * 100)}%`).join(' · ') : '차단 없음' },
    { label: '잘못 찾은 비율', value: '3.1%', delta: '-0.9p', ds: okStyle, note: '직원 신고 · 관리자 확인 기준', mock: true },
    { label: '검사 시간 p95', value: sampleStats ? `${Math.round(sampleStats.p95)}ms` : '—', delta: null, ds: neutral, note: '목표 80ms 이내 · 외부 LLM 시간 포함' },
  ];

  const slackOn = settings.data?.slackConnected ?? true;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">모니터 / 분석 리포트</div>
          <h1>분석 리포트</h1>
          <p className="t2">
            {from.getFullYear()}.{md(from)} – {md(now)} · 직전 {days}일과 비교
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Seg label="기간" mono options={RANGES} value={range} onChange={setRange} />
          <button type="button" className="btn" onClick={() => window.print()}>
            PDF 리포트
          </button>
          <button type="button" className="btn btn-p" onClick={() => toast('정기 발송은 서버에 리포트 예약 API가 생기면 저장돼요 (지금은 예시)')}>
            정기 발송 설정
          </button>
        </div>
      </header>

      {cur.error ? <QueryState error={cur.error} onRetry={() => cur.refetch()} /> : null}

      <section aria-label="요약 지표" className="vz" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} className="card vz-card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{k.label}</span>
              {k.mock ? (
                <MockBadge />
              ) : (
                k.delta && (
                  <span className="mono" style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, ...k.ds }}>
                    {k.delta}
                  </span>
                )
              )}
            </div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', marginTop: 10 }}>
              {k.value}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 4 }}>{k.note}</div>
          </div>
        ))}
      </section>

      <div className="row-wrap vz">
        {[
          { key: 'r', title: '일별 가림', hero: avg(rCur), cap: '가린 항목 · 하루 평균', color: '#2a78d6', curV: rCur, prevV: rPrev },
          { key: 'b', title: '일별 차단', hero: avg(bCur), cap: '차단 건수 · 하루 평균', color: '#e34948', curV: bCur, prevV: bPrev },
        ].map((c, idx) => (
          <section key={c.key} className="card vz-card" style={{ flex: idx === 0 ? '3 1 560px' : '2 1 380px' }}>
            <div className="vz-head">
              <div>
                <h2 className="vz-title">{c.title}</h2>
                <div className="vz-hero">
                  <b>{fmt(c.hero)}</b>
                  <span>{c.cap}</span>
                </div>
              </div>
              <div className="vz-leg">
                <div>
                  <span>
                    <i className="vz-swl" style={{ background: c.color }} />
                    이번 {days}일
                  </span>
                </div>
                <div>
                  <span>
                    <i className="vz-swd" />
                    직전 {days}일
                  </span>
                </div>
              </div>
            </div>
            {ts.error ? (
              <QueryState error={ts.error} onRetry={() => ts.refetch()} />
            ) : (
              <LineChart
                aria={`${days}일간 ${c.title} 건수. 하루 평균 ${fmt(c.hero)}건.`}
                series={[
                  { name: '이번', color: c.color, values: c.curV, area: true },
                  { name: '직전', color: '#A9B6C8', values: c.prevV, dashed: true },
                ]}
                xLabels={xLabels}
                titleAt={dayAt}
              />
            )}
          </section>
        ))}
      </div>

      <div className="row-wrap vz">
        <section className="card vz-card" style={{ flex: '3 1 600px' }}>
          <div className="vz-head">
            <div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <h2 className="vz-title">부서 × 정보 종류 · 30일</h2>
                <MockBadge />
              </div>
              <div className="vz-hero">
                <b>{fmt(hmMax?.v)}</b>
                <span>가장 많은 칸 · {hmMax?.where ?? '—'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-mute)' }} aria-hidden="true">
              <span>적음</span>
              {RAMP.map((c) => (
                <i key={c} style={{ width: 18, height: 10, borderRadius: 3, background: c }} />
              ))}
              <span>많음</span>
            </div>
          </div>
          {hm && (
            <table style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 6, margin: '-6px' }} aria-label="부서별 정보 종류 건수 (예시 값)">
              <thead>
                <tr>
                  <th style={{ width: 80, border: 0, padding: 0 }} />
                  {hm.cols.map((c) => (
                    <th key={c} scope="col" style={{ textAlign: 'center', border: 0, padding: '0 0 4px', font: '12px var(--font-sans)', color: 'var(--ink-2)', letterSpacing: 0, whiteSpace: 'normal' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hm.rows.map((r) => (
                  <tr key={r.dept}>
                    <th scope="row" style={{ border: 0, padding: 0, font: '500 12.5px var(--font-sans)', color: 'var(--ink-body)', letterSpacing: 0 }}>
                      {r.dept}
                    </th>
                    {r.values.map((v, i) => (
                      <td key={i} style={{ padding: 0, border: 0, height: 44, textAlign: 'center', borderRadius: 8, font: '500 12.5px var(--font-mono)', background: v ? RAMP[bin(v)] : 'rgba(15,26,43,.04)', color: v ? (bin(v) >= 3 ? '#fff' : 'var(--ink)') : '#A1A1AA' }}>
                        {v ? fmt(v) : '–'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ fontSize: 11.5, margin: '12px 0 0', color: 'var(--ink-mute)' }}>연구소의 조성비가 많은 건 정상 업무예요. 영업의 계좌번호가 늘고 있어 견적서 작성 방식을 확인해 볼 만해요.</p>
        </section>

        <section className="card vz-card" style={{ flex: '2 1 340px' }}>
          <div className="vz-head" style={{ marginBottom: 10 }}>
            <div>
              <h2 className="vz-title">정보 종류별 집계 · {days}일</h2>
              <div className="vz-hero">
                <b>{fmt(types.reduce((a, t) => a + t.value, 0))}</b>
                <span>건 찾음</span>
              </div>
            </div>
          </div>
          <QueryState isLoading={cur.isLoading} />
          {s && <RankBars items={types} limit={7} />}
        </section>
      </div>

      <div className="row-wrap vz">
        <section className="card vz-card" style={{ flex: '3 1 600px' }}>
          <div className="vz-head">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <h2 className="vz-title">규칙별 정확도</h2>
              <span className="badge b-accent">템플릿 시험 문장 기준</span>
            </div>
            <div className="vz-leg">
              <div>
                <span>
                  <i className="vz-sw" style={{ background: '#2a78d6' }} />
                  놓치지 않은 비율 · 템플릿 적용
                </span>
              </div>
              <div>
                <span>
                  <i className="vz-sw" style={{ background: '#64748B' }} />
                  놓치지 않은 비율 · 기본 규칙만
                </span>
              </div>
            </div>
          </div>
          <QueryState isLoading={evalReport.isLoading} error={evalReport.error} onRetry={() => evalReport.refetch()} />
          {evalReport.data && (
            <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) minmax(0,1fr) 70px', gap: '8px 16px', alignItems: 'center', fontSize: 12.5 }}>
              <span className="lbl">규칙</span>
              <span className="lbl">템플릿 재현율 %</span>
              <span className="lbl">기본 규칙 재현율 %</span>
              <span className="lbl" style={{ textAlign: 'right' }}>
                잘못 찾음
              </span>
              {[...evalReport.data.industries, { industry: '전체', template_recall: evalReport.data.overall.template_recall, generic_recall: evalReport.data.overall.generic_recall, expected: evalReport.data.overall.expected, template_false_positives: null as number | null, negative_cases: null as number | null }].map((r) => {
                const tr = r.template_recall == null ? null : Math.round(r.template_recall * 100);
                const gr = r.generic_recall == null ? null : Math.round(r.generic_recall * 100);
                return (
                  <div key={r.industry} style={{ display: 'contents' }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: r.industry === '전체' ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.industry === '전체' ? '전체' : `업종 묶음 · ${industryName(r.industry)}`}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-mute)' }}>정답 값 {r.expected}개</span>
                    </span>
                    {[
                      [tr, '#2a78d6'],
                      [gr, '#64748B'],
                    ].map(([v, c], k) => (
                      <span key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 30px', gap: 8, alignItems: 'center' }}>
                        <span className="vz-track">
                          <i style={{ width: `${v ?? 0}%`, background: c as string }} />
                        </span>
                        <span className="vz-num">{v ?? '—'}</span>
                      </span>
                    ))}
                    <span className="vz-num">{r.negative_cases == null ? '' : `${r.template_false_positives}/${r.negative_cases}`}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p style={{ fontSize: 11.5, margin: '12px 0 0', color: 'var(--ink-mute)' }}>GET /v1/eval · 각 업종 템플릿의 tests를 정답으로 계산해요. 잘못 찾음 = 찾으면 안 되는 문장에서 잘못 찾은 수 / 그런 문장 수. 실제 사용 중 정밀도는 아니에요.</p>
        </section>

        <section className="card vz-card" style={{ flex: '2 1 380px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="ch" style={{ margin: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <h2 className="ct">교육 대상 후보</h2>
              <MockBadge />
            </div>
            <span className="t3" style={{ fontSize: 12 }}>
              하루에 같은 이유로 3번 이상 막힌 사람
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cands.data?.map((c) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.95)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {c.user}{' '}
                    <span className="t3" style={{ fontWeight: 400, fontSize: 12.5 }}>
                      · {c.dept}
                    </span>
                  </div>
                  <div className="t3" style={{ fontSize: 12, marginTop: 3 }}>
                    {c.why} · <b style={{ color: 'var(--danger)', fontWeight: 600 }}>{c.n}회</b>
                  </div>
                </div>
                {c.sentAt ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#047857', textAlign: 'right' }}>
                    보냄 ✓<span style={{ display: 'block', fontWeight: 400, color: 'var(--ink-mute)', fontSize: 11 }}>{c.sentAt}</span>
                  </span>
                ) : (
                  <button type="button" className="btn btn-sm" style={{ gap: 6 }} disabled={!slackOn || (send.isPending && send.variables === c.id)} title={slackOn ? undefined : 'Slack이 연결돼 있지 않아요'} onClick={() => send.mutate(c.id)}>
                    <Icon name="send" size={13} width={2} />
                    Slack 보내기
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} aria-expanded={preview} onClick={() => setPreview(!preview)}>
            {preview ? '메시지 접기' : '보내는 메시지 보기'}
          </button>
          {preview && (
            <div style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 12, background: '#F8F8F8', border: '1px solid #EEE' }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--ink)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                <Icon name="shield" size={14} stroke="#fff" width={2.2} />
              </span>
              <div style={{ fontSize: 12, lineHeight: 1.65, minWidth: 0 }}>
                <b>{settings.data?.slackAppName ?? 'Gateway 보안 알림'}</b>{' '}
                <span className="t3" style={{ fontSize: 11 }}>
                  앱
                </span>
                <div style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{SLACK_MSG}</div>
              </div>
            </div>
          )}
          <p className="t3" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.6 }}>
            이 목록과 발송 기록은 보안 관리자에게만 보이고 인사 평가에 쓰지 않아요. Slack은 <Link to="/console/settings#notify">설정 › Slack 연동</Link>에서 연결해요.
          </p>
        </section>
      </div>

      <section className="card" style={{ maxWidth: 'calc(50% - 8px)', minWidth: 'min(420px, 100%)' }}>
        <div className="ch">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <h2 className="ct">정기 리포트</h2>
            <MockBadge />
          </div>
          <button type="button" className="btn btn-sm" onClick={() => toast('정기 리포트 추가는 서버에 예약 API가 생기면 저장돼요')}>
            추가
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sched.data?.map((r) => (
            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,.5)', border: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</div>
                <div className="t3" style={{ fontSize: 11.5, marginTop: 3 }}>
                  {r.when} · {r.to}
                </div>
              </div>
              <span className={`badge ${r.on ? 'b-clean' : 'b-muted'}`}>{r.on ? 'ON' : 'DRAFT'}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
