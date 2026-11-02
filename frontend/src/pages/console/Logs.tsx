// 03 기록 (Logs.dc.html). "전송 기록" = GET /v1/audit/events (limit · offset · label · status).
// "관리자 작업" is a mock until the server keeps an admin audit trail.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import { consoleApi } from '../../api/console';
import { gateway } from '../../api/gateway';
import type { AuditEvent, AuditStatus } from '../../api/types';
import { MockBadge, Seg } from '../../components/Controls';
import { Icon } from '../../components/Icon';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { findingsText, fmt, hms, OUTCOME_BADGE, outcomeOf, providerName, ymdhms } from '../../features/format';
import { qk } from '../../features/queries';

const PAGE = 12;
const STATUS_OPTS: [AuditStatus | '', string][] = [
  ['', '전체'],
  ['blocked', '차단'],
  ['response_blocked', '응답 차단'],
  ['ok', '통과 · 가림'],
  ['upstream_error', '외부 LLM 오류'],
];
const TONE_CLS = { clean: 'b-clean', accent: 'b-accent', redact: 'b-redact', block: 'b-block', muted: 'b-muted' } as const;

/** "a,b,c" -> "a, b, c": the stored list has no spaces, so a long one could never wrap. */
const industryText = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).join(', ');

/** Where a record's exception story lives: the request that let it through, or the requests about what it blocked. */
function exceptionLink(e: AuditEvent): { to: string; label: string } {
  if (e.exception_id) return { to: `/console/exceptions?req=${encodeURIComponent(e.exception_id)}`, label: `예외 요청 보기 · ${e.exception_id}` };
  const labels = [...new Set(e.findings.map((f) => f.label))];
  if (!labels.length) return { to: '/console/exceptions', label: '관련 예외 요청' };
  const q = new URLSearchParams({ entity: labels.join(',') });
  if (e.site) q.set('site', e.site);
  return { to: `/console/exceptions?${q.toString()}`, label: '관련 예외 요청 보기' };
}

const reqId = (e: AuditEvent) => `req_${e.id.toString(16).padStart(6, '0')}`;
const itemCount = (e: AuditEvent) => e.findings.reduce((a, f) => a + f.count, 0);
const ruleText = (e: AuditEvent) => [...new Set(e.findings.map((f) => f.label))].join(' · ') || '—';

function toCsv(rows: AuditEvent[]): string {
  const head = ['id', 'time', 'endpoint', 'provider', 'route', 'status', 'industries', 'latency_ms', 'findings'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map((e) =>
    [e.id, ymdhms(e.ts), e.endpoint, e.provider, e.route, e.status, e.industries, e.latency_ms ?? '', e.findings.map((f) => `${f.direction}:${f.label}:${f.action}:${f.count}`).join(' ')].map(esc).join(','),
  );
  return [head.join(','), ...body].join('\n');
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function LogsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'admin' ? 1 : 0;
  const { toast, confirm } = useFeedback();
  const qc = useQueryClient();
  // Admin only, no undo: empties the gateway's audit log (used before a demo).
  const clearAudit = useMutation({
    mutationFn: gateway.clearAudit,
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast(`전송 기록 ${r.deleted}건을 지웠어요`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState<AuditStatus | ''>('');
  const [label, setLabel] = useState('');
  const [page, setPage] = useState(0);
  const [selId, setSelId] = useState<number | null>(null);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const query = { limit: PAGE, offset: page * PAGE, status: status || undefined, label: label || undefined };
  const events = useQuery({ queryKey: qk.audit(query), queryFn: () => gateway.auditEvents(query), placeholderData: keepPreviousData, enabled: tab === 0 });
  const all = useQuery({ queryKey: qk.summary(0), queryFn: () => gateway.summary(0), enabled: tab === 0 });
  const adminLog = useQuery({ queryKey: qk.adminLog, queryFn: consoleApi.adminLog, enabled: tab === 1 });

  const labels = useMemo(() => [...new Set((all.data?.findings ?? []).map((f) => f.label))], [all.data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (events.data ?? []).filter((e) => {
      if (onlyFlagged && !flagged.has(e.id)) return false;
      if (!needle) return true;
      return [reqId(e), String(e.id), e.provider, e.status, e.industries, ruleText(e)].some((v) => v.toLowerCase().includes(needle));
    });
  }, [events.data, q, onlyFlagged, flagged]);

  const sel = rows.find((e) => e.id === selId) ?? rows[0];
  const filtered = !!(status || label || q || onlyFlagged);
  const hasNext = (events.data?.length ?? 0) === PAGE;

  const setFilter = (fn: () => void) => {
    fn();
    setPage(0);
    setSelId(null);
  };

  const views = [
    { name: '차단만', on: status === 'blocked' && !label && !onlyFlagged, apply: () => setFilter(() => (setStatus('blocked'), setLabel(''), setOnlyFlagged(false))) },
    { name: '연구소', on: false, apply: () => toast('부서별 보기는 감사 로그에 부서가 생기면 쓸 수 있어요', 'error') },
    { name: '오탐 신고됨', on: onlyFlagged, apply: () => setFilter(() => setOnlyFlagged(!onlyFlagged)) },
    { name: '예외 승인으로 보냄', on: false, apply: () => toast('예외 승인 연결은 서버에 예외 요청 API가 생기면 쓸 수 있어요', 'error') },
  ];

  const steps = (e: AuditEvent) => {
    const o = outcomeOf(e);
    const n = itemCount(e);
    const s = [
      { name: '수신', note: `${e.endpoint} · ${e.stream ? '스트리밍' : '일반 응답'}`, color: '#4A5568' },
      { name: '탐지', note: n ? `${ruleText(e)} 규칙으로 찾음` : '찾은 것 없음', color: '#2563EB' },
      { name: '정책 판정', note: `경로 ${e.route}${e.industries ? ` · 업종 ${industryText(e.industries)}` : ''}`, color: '#1D4ED8' },
    ];
    if (e.exception_id) s.push({ name: '예외 승인 적용', note: `${e.exception_id}에 적힌 항목은 가리지 않음`, color: '#7C3AED' });
    if (e.status === 'blocked') s.push({ name: '전송 막음', note: '밖으로 나간 것 없음', color: '#DC2626' });
    else if (e.status === 'response_blocked') s.push({ name: '답변 막음', note: '답변에 차단 대상이 있어 돌려주지 않음', color: '#DC2626' });
    else if (e.status === 'upstream_error') s.push({ name: '외부 LLM 오류', note: '전송은 했지만 답을 받지 못함', color: '#B45309' });
    else {
      s.push({ name: o === 'internal' ? '내부 모델로 처리' : '가린 뒤 전송', note: `${n}개 값을 이름표로 바꿈`, color: '#047857' });
      s.push({ name: '답변 확인 · 복원', note: '답변 스캔 후 원래 값으로 되돌림', color: '#B45309' });
    }
    return s;
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">모니터 / 기록</div>
          <h1>기록</h1>
          <p className="t2">{tab === 0 ? '직원이 AI에 보낸 것에서 무엇을 찾고 어떻게 처리했나 · 원문은 저장하지 않아요' : '관리자가 콘솔에서 한 일 · 가입 승인, 규칙 적용, 예외 승인, 설정 변경'}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Seg
            label="기록 종류"
            options={[
              [0, '전송 기록'],
              [1, '관리자 작업'],
            ]}
            value={tab}
            onChange={(v) => setParams(v ? { tab: 'admin' } : {})}
          />
          <button
            type="button"
            className="btn"
            disabled={tab === 0 ? !rows.length : !adminLog.data?.length}
            onClick={() => {
              if (tab === 0) download(`gateway-audit-${Date.now()}.csv`, toCsv(rows));
              else {
                const a = adminLog.data ?? [];
                download(`gateway-admin-${Date.now()}.csv`, ['time,who,action,target,note', ...a.map((r) => [r.t, r.who, r.act, r.target, r.note].map((v) => `"${v.replace(/"/g, '""')}"`).join(','))].join('\n'));
              }
              toast('CSV 내보내기를 시작했습니다 · 메타데이터만 포함');
            }}
          >
            CSV 내보내기
          </button>
          {tab === 0 && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (await confirm({ title: '전송 기록 모두 지우기', body: '게이트웨이에 쌓인 전송 기록과 이상 징후 확인 표시가 모두 지워져요. 되돌릴 수 없어요. 발표 전에 테스트 기록을 비울 때 쓰세요.', ok: '모두 지우기', danger: true })) clearAudit.mutate();
              }}
            >
              기록 비우기
            </button>
          )}
        </div>
      </header>

      {tab === 0 && (
        <>
          <section className="card" aria-label="필터" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ flex: '1 1 260px', display: 'flex' }}>
                <span className="sr-only">검색</span>
                <input className="in" style={{ width: '100%' }} placeholder="요청 ID, 사용자, 규칙 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
              <label className="inline-field" title="감사 API에 기간 조건이 아직 없어요">
                기간{' '}
                <select className="sel" disabled>
                  <option>전체</option>
                </select>
              </label>
              <label className="inline-field">
                처리{' '}
                <select className="sel" value={status} onChange={(e) => setFilter(() => setStatus(e.target.value as AuditStatus | ''))}>
                  {STATUS_OPTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field">
                정보 종류{' '}
                <select className="sel" value={label} onChange={(e) => setFilter(() => setLabel(e.target.value))}>
                  <option value="">전체</option>
                  {labels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field" title="감사 로그에 사이트가 아직 없어요 (provider만 있음)">
                사이트{' '}
                <select className="sel" disabled>
                  <option>전체</option>
                </select>
              </label>
              <label className="inline-field" title="감사 로그에 부서가 아직 없어요">
                부서{' '}
                <select className="sel" disabled>
                  <option>전체</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="lbl">저장된 보기</span>
              {views.map((v) => (
                <button key={v.name} type="button" className="chip" aria-pressed={v.on} onClick={v.apply}>
                  {v.name}
                </button>
              ))}
              {filtered && (
                <button type="button" className="link-btn" onClick={() => setFilter(() => (setStatus(''), setLabel(''), setQ(''), setOnlyFlagged(false)))}>
                  필터 지우기
                </button>
              )}
              <span className="t3" style={{ fontSize: 13, marginLeft: 'auto' }}>
                {filtered ? `이 페이지 ${rows.length}건` : `결과 ${fmt(all.data?.requests)}건`}
              </span>
            </div>
          </section>

          <div className="row-wrap top">
            <section className="card" style={{ flex: '2 1 600px', padding: '14px 8px 8px' }}>
              <QueryState isLoading={events.isLoading} error={events.error} onRetry={() => events.refetch()} />
              {events.data && (
                <div className="tbl">
                  <table>
                    <thead>
                      <tr>
                        <th>시각</th>
                        <th>요청</th>
                        <th>사용자</th>
                        <th>사이트</th>
                        <th>찾은 것</th>
                        <th className="num">개수</th>
                        <th>처리</th>
                        <th>규칙</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={8} className="empty">
                            조건에 맞는 기록이 없어요
                          </td>
                        </tr>
                      )}
                      {rows.map((e) => {
                        const b = OUTCOME_BADGE[outcomeOf(e)];
                        const on = sel?.id === e.id;
                        return (
                          <tr key={e.id} className={on ? 'is-selected' : ''} onClick={() => setSelId(e.id)} style={{ cursor: 'pointer' }}>
                            <td>
                              <button type="button" className="link-btn mono" style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 12.5 }} aria-label={`${reqId(e)} 상세 보기`} aria-pressed={on} onClick={() => setSelId(e.id)}>
                                {hms(e.ts)}
                              </button>
                            </td>
                            <td className="mono" style={{ fontSize: 12.5, color: 'var(--link)' }}>
                              {reqId(e)}
                              {e.exception_id && (
                                <span className="badge b-accent" style={{ marginLeft: 6 }} title={`예외 승인 ${e.exception_id}로 그대로 보냄`}>
                                  예외
                                </span>
                              )}
                              {flagged.has(e.id) && (
                                <span className="badge b-redact" style={{ marginLeft: 6 }}>
                                  오탐
                                </span>
                              )}
                            </td>
                            <td className="t3" title={e.caller ? '호출한 앱 (API 키 이름)' : '키를 쓰지 않았거나 사용자가 아직 없어요'}>
                              {e.caller ?? '—'}
                            </td>
                            <td className="t2">{providerName(e.provider)}</td>
                            <td className="t2">{findingsText(e)}</td>
                            <td className="mono num">{itemCount(e)}</td>
                            <td>
                              <span className={`badge ${b.cls}`}>{b.label}</span>
                            </td>
                            <td className="t3" style={{ fontSize: 13 }}>
                              <div className="wrap-any" style={{ maxWidth: 220 }}>
                                {e.industries ? `업종 ${industryText(e.industries)}` : '기본 규칙'}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <nav aria-label="페이지" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 10px 4px', flexWrap: 'wrap', gap: 10 }}>
                <span className="t3" style={{ fontSize: 13 }}>
                  {events.data?.length ? `${page * PAGE + 1}–${page * PAGE + events.data.length}${filtered ? '' : ` / ${fmt(all.data?.requests)}`}` : '0건'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    이전
                  </button>
                  {Array.from({ length: page + (hasNext ? 2 : 1) }, (_, i) => i)
                    .slice(-3)
                    .map((i) => (
                      <button key={i} type="button" className="btn btn-sm" aria-current={i === page ? 'page' : undefined} style={i === page ? { borderColor: 'var(--accent)', background: '#fff' } : undefined} onClick={() => setPage(i)}>
                        {i + 1}
                      </button>
                    ))}
                  <button type="button" className="btn btn-sm" disabled={!hasNext} onClick={() => setPage(page + 1)}>
                    다음
                  </button>
                </div>
              </nav>
            </section>

            <aside id="detail" className="card" aria-label="요청 상세" style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!sel ? (
                <div className="empty">왼쪽에서 기록을 고르면 처리 과정을 보여 드려요</div>
              ) : (
                <>
                  <div>
                    <div className="lbl">REQUEST DETAIL</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                      <h2 className="mono" style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--accent-ink)' }}>
                        {reqId(sel)}
                      </h2>
                      <span className={`badge ${OUTCOME_BADGE[outcomeOf(sel)].cls}`}>{OUTCOME_BADGE[outcomeOf(sel)].label}</span>
                    </div>
                  </div>
                  <dl className="kv" style={{ gridTemplateColumns: '110px minmax(0,1fr)' }}>
                    <dt>시각</dt>
                    <dd className="mono">{ymdhms(sel.ts)}</dd>
                    <dt>호출한 앱</dt>
                    <dd className="t3">{sel.caller ?? '키를 쓰지 않음'}</dd>
                    {sel.exception_id && (
                      <>
                        <dt>예외 승인</dt>
                        <dd className="mono">{sel.exception_id} · 승인된 항목은 가리지 않고 그대로 보냄</dd>
                      </>
                    )}
                    <dt>경로</dt>
                    <dd className="mono">{sel.endpoint}</dd>
                    <dt>대상</dt>
                    <dd>
                      {providerName(sel.provider)} · {sel.route}
                    </dd>
                    <dt>탐지</dt>
                    <dd>
                      {findingsText(sel)} ({itemCount(sel)}건)
                    </dd>
                    <dt>적용 규칙</dt>
                    <dd>{sel.industries ? `기본 규칙 + 업종 ${industryText(sel.industries)}` : '기본 규칙'}</dd>
                  </dl>
                  <div>
                    <div className="lbl" style={{ marginBottom: 10 }}>
                      처리 타임라인
                    </div>
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {steps(sel).map((s, i) => (
                        <li key={i} style={{ display: 'grid', gridTemplateColumns: '14px minmax(0,1fr) auto', gap: 10, alignItems: 'start', paddingBottom: 10 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 4, background: s.color }} />
                          <span style={{ fontSize: 13.5 }}>
                            {s.name}
                            <span className="t3 wrap-any" style={{ display: 'block', fontSize: 12.5 }}>
                              {s.note}
                            </span>
                          </span>
                          <span className="mono t3" style={{ fontSize: 12 }}>
                            {i === steps(sel).length - 1 && sel.latency_ms != null ? `${Math.round(sel.latency_ms)}ms` : ''}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="note-box">
                    <Icon name="lock" size={16} stroke="#4A5568" />
                    <p className="t2" style={{ margin: 0 }}>
                      원문과 원래 값은 직원 브라우저 탭에만 잠깐(30분) 있다가 지워졌어요. 서버에는 남지 않아 관리자도 볼 수 없어요.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-pressed={flagged.has(sel.id)}
                      onClick={() => {
                        const next = new Set(flagged);
                        if (next.has(sel.id)) next.delete(sel.id);
                        else next.add(sel.id);
                        setFlagged(next);
                        toast(next.has(sel.id) ? '잘못 찾은 것으로 표시했어요 · 규칙 확인 목록에 추가' : '오탐 표시를 지웠어요');
                      }}
                    >
                      {flagged.has(sel.id) ? '오탐 신고 취소' : '오탐 신고'}
                    </button>
                    <Link className="btn btn-sm" to="/console/policy">
                      규칙 열기
                    </Link>
                    <Link className="btn btn-sm" to={exceptionLink(sel).to} data-testid="to-exception">
                      {exceptionLink(sel).label}
                    </Link>
                  </div>
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {tab === 1 && (
        <section className="card" style={{ padding: '14px 8px 8px' }}>
          <div className="ch" style={{ padding: '0 10px' }}>
            <h2 className="ct">
              관리자 작업{' '}
              <span className="t3" style={{ fontWeight: 400, fontSize: 13.5 }}>
                · 누가 언제 무엇을 바꿨나 · 지울 수 없어요
              </span>
            </h2>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <MockBadge />
              <span className="t3" style={{ fontSize: 13 }}>
                최근 7일 · {adminLog.data?.length ?? 0}건
              </span>
            </span>
          </div>
          <QueryState isLoading={adminLog.isLoading} error={adminLog.error} />
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>관리자</th>
                  <th>작업</th>
                  <th>대상</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {adminLog.data?.map((a, i) => (
                  <tr key={i}>
                    <td className="mono t3" style={{ fontSize: 12.5 }}>
                      {a.t}
                    </td>
                    <td style={{ fontWeight: 500 }}>{a.who}</td>
                    <td>
                      <span className={`badge ${TONE_CLS[a.tone]}`}>{a.act}</span>
                    </td>
                    <td>{a.target}</td>
                    <td className="t2" style={{ whiteSpace: 'normal' }}>
                      {a.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
