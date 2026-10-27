// 06 예외 요청 (Exceptions.dc.html). Mock: the gateway has no exception workflow yet.
// Requests sent from the user portal (/me/request) show up here because both read the same mock store.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import type { Decision, ExceptionStatus, Ttl } from '../../api/consoleTypes';
import { MockBadge, Seg } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { qk, useExceptions } from '../../features/queries';

const TTL_OPTS = [
  ['1x', '1회'],
  ['1h', '1시간'],
  ['24h', '24시간'],
  ['7d', '7일'],
] as const;
const TTL_KO: Record<Ttl, string> = { '1x': '1회', '1h': '1시간', '24h': '24시간', '7d': '7일' };
const TTL_HELP: Record<Ttl, string> = {
  '1x': '이번 요청 1건만 원문으로 전송합니다. 이후 같은 내용도 다시 차단됩니다.',
  '1h': '1시간 동안 같은 사용자 · 같은 엔티티 · 같은 대상에 한해 허용합니다.',
  '24h': '24시간 허용. 만료 시 자동 회수되고 사용 내역이 감사 로그에 남습니다.',
  '7d': '7일 허용은 CISO 추가 승인이 필요합니다.',
};
const SEV_CLS = { CRITICAL: 'b-block', HIGH: 'b-redact', MEDIUM: 'b-muted' } as const;
const SLA_COLOR = ['var(--ink-2)', '#B45309', '#B91C1C'];
const TABS: [ExceptionStatus, string][] = [
  ['pending', '대기'],
  ['approved', '승인됨'],
  ['rejected', '반려됨'],
  ['expired', '만료'],
];

export function ExceptionsPage() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const list = useExceptions();
  const [tab, setTab] = useState<ExceptionStatus>('pending');
  const [selId, setSelId] = useState<string | null>(null);
  const [ttl, setTtl] = useState<Ttl>('1x');
  const [memo, setMemo] = useState('');

  const all = list.data ?? [];
  const rows = all.filter((e) => e.status === tab);
  const cur = rows.find((e) => e.id === selId) ?? rows[0];
  const pending = all.filter((e) => e.status === 'pending');

  useEffect(() => {
    setMemo(cur?.memo ?? '');
    setTtl(cur?.ttl ?? '1x');
  }, [cur?.id, cur?.memo, cur?.ttl]);

  const decide = useMutation({
    mutationFn: ({ d }: { d: Decision }) => consoleApi.decideException(cur!.id, d, ttl, memo),
    onSuccess: (_, { d }) => {
      qc.invalidateQueries({ queryKey: qk.exceptions });
      qc.invalidateQueries({ queryKey: qk.adminLog });
      qc.invalidateQueries({ queryKey: qk.portal('requests') });
      toast(d === 'approved' ? `승인했습니다 · ${TTL_KO[ttl]} 동안 허용 · 요청자에게 알림` : '예외 요청을 반려했습니다 · 요청자에게 알림 발송');
      setSelId(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  async function onDecide(d: Decision) {
    const spec =
      d === 'approved'
        ? { title: '예외 요청 승인', body: `${TTL_KO[ttl]} 동안만 이 사용자·이 항목·이 대상에 한해 원문 전송을 허용합니다. 사용 내역은 감사 로그에 남습니다.`, ok: '승인' }
        : { title: '예외 요청 반려', body: '요청자에게 결정 메모와 함께 반려 사유가 전달됩니다.', ok: '반려', danger: true };
    if (await confirm(spec)) decide.mutate({ d });
  }

  const approvedN = all.filter((e) => e.status === 'approved').length;
  const rejectedN = all.filter((e) => e.status === 'rejected').length;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">정책 / 예외 요청</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <h1 style={{ margin: 0 }}>예외 요청</h1>
            <MockBadge />
          </div>
          <p className="t2">차단된 사용자가 보낸 원문 전송 요청 · 승인 시 지정된 범위와 시간 동안만 허용됩니다</p>
        </div>
        <Link className="btn" to="/console/settings">
          승인 정책 설정
        </Link>
      </header>

      <section aria-label="요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 16 }}>
        {[
          ['PENDING', pending.length, `SLA 임박 ${pending.filter((e) => e.slaUrgent > 0).length}건`, '#B45309'],
          ['APPROVED 30D', 37 + approvedN, '평균 처리 2시간 14분', undefined],
          ['REJECTED 30D', 16 + rejectedN, `반려율 ${Math.round(((16 + rejectedN) / (53 + approvedN + rejectedN)) * 100)}%`, undefined],
          ['ACTIVE GRANTS', 3 + approvedN, '가장 빠른 만료 47분 후', undefined],
        ].map(([l, v, n, c]) => (
          <div key={l as string} className="card" style={{ padding: '14px 16px' }}>
            <div className="lbl">{l}</div>
            <div className="mono" style={{ fontSize: 24, marginTop: 6 }}>
              {v}
            </div>
            <div className={c ? undefined : 't3'} style={{ fontSize: 12, marginTop: 4, color: c as string | undefined }}>
              {n}
            </div>
          </div>
        ))}
      </section>

      <div className="row-wrap top">
        <section className="card" style={{ flex: '2 1 420px', padding: 0, overflow: 'hidden' }}>
          <div className="tabs" role="tablist" aria-label="요청 상태" style={{ padding: '0 12px' }}>
            {TABS.map(([v, l]) => {
              const on = tab === v;
              const n = all.filter((e) => e.status === v).length;
              return (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => {
                    setTab(v);
                    setSelId(null);
                  }}
                  onKeyDown={(e) => {
                    const i = TABS.findIndex((t) => t[0] === v);
                    const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : e.key === 'ArrowLeft' ? TABS[(i + TABS.length - 1) % TABS.length] : null;
                    if (next) {
                      setTab(next[0]);
                      setSelId(null);
                      (e.currentTarget.parentElement?.children[TABS.indexOf(next)] as HTMLElement | undefined)?.focus();
                    }
                  }}
                >
                  {v === 'pending' ? `${l} ${n}` : l}
                </button>
              );
            })}
          </div>
          <QueryState isLoading={list.isLoading} error={list.error} />
          <ul role="tabpanel" style={{ listStyle: 'none', margin: 0, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rows.length === 0 && list.data && <li className="empty">이 상태의 요청이 없어요</li>}
            {rows.map((r) => {
              const on = cur?.id === r.id;
              return (
                <li key={r.id}>
                  <button type="button" className={`exc-item${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setSelId(r.id)}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', width: '100%' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {r.user}{' '}
                        <span className="t3" style={{ fontWeight: 400 }}>
                          · {r.dept}
                        </span>
                      </span>
                      <span className="mono" style={{ fontSize: 11, color: r.status === 'pending' ? SLA_COLOR[r.slaUrgent] : 'var(--ink-3)' }}>
                        {r.status === 'pending' ? r.sla : r.requestedAt}
                      </span>
                    </span>
                    <span className="t2" style={{ fontSize: 12.5, marginTop: 6, textAlign: 'left' }}>
                      {r.title}
                    </span>
                    <span style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${SEV_CLS[r.sev]}`}>{r.sev}</span>
                      <span className="chip">{r.entity}</span>
                      <span className="chip">{r.scope}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card" style={{ flex: '3 1 520px', display: 'flex', flexDirection: 'column', gap: 18 }} aria-label="요청 상세">
          {!cur ? (
            <div className="empty">왼쪽에서 요청을 고르세요</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="lbl">{cur.id}</div>
                  <h2 style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 600 }}>{cur.title}</h2>
                </div>
                <span className={`badge ${SEV_CLS[cur.sev]}`}>
                  {cur.sev} · {cur.status === 'pending' ? cur.sla : TABS.find((t) => t[0] === cur.status)?.[1]}
                </span>
              </div>
              <dl className="kv" style={{ gridTemplateColumns: '110px minmax(0,1fr)' }}>
                <dt>요청자</dt>
                <dd>
                  {cur.user} · {cur.dept} · 정책 편집 권한 없음
                </dd>
                <dt>차단된 항목</dt>
                <dd>
                  {cur.entity} — 규칙{' '}
                  <span className="mono" style={{ fontSize: 12 }}>
                    {cur.rule}
                  </span>
                </dd>
                <dt>대상</dt>
                <dd>{cur.target}</dd>
                <dt>요청 범위</dt>
                <dd>{cur.scope}</dd>
                <dt>최근 이력</dt>
                <dd>{cur.history}</dd>
              </dl>
              <div>
                <div className="lbl" style={{ marginBottom: 8 }}>
                  요청 사유 (사용자 작성)
                </div>
                <blockquote style={{ margin: 0, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,.5)', border: '1px solid var(--line)', fontSize: 13, lineHeight: 1.7 }}>{cur.reason}</blockquote>
              </div>
              <div role="note" style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(37,99,235,.08)', border: '1px solid rgba(37,99,235,.3)', fontSize: 12.5, lineHeight: 1.6 }}>
                <span className="badge b-accent" style={{ flex: '0 0 auto' }}>
                  대안
                </span>
                <span>{cur.alt}</span>
              </div>
              {cur.status === 'pending' ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span className="lbl">승인 시 허용 기간</span>
                    <Seg label="허용 기간" options={TTL_OPTS} value={ttl} onChange={setTtl} />
                    <span className="t3" style={{ fontSize: 11.5 }}>
                      {TTL_HELP[ttl]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                    <span className="lbl">승인 · 보안관리자가 결정</span>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.5)', border: '1px solid var(--line)' }}>
                      <span className="av" style={{ background: 'rgba(255,255,255,.88)' }}>
                        나
                      </span>
                      <span style={{ fontSize: 12.5, flex: 1 }}>
                        보안관리자
                        <span className="t3" style={{ display: 'block', fontSize: 11 }}>
                          이 화면에서 승인 · 반려 · 기간을 정하면 바로 적용돼요 · 다른 사람 확인 단계 없음
                        </span>
                      </span>
                      <span className="badge b-muted">WAIT</span>
                    </div>
                  </div>
                  <label className="field">
                    <span>결정 메모 (요청자에게 전달)</span>
                    <textarea className="ta" style={{ minHeight: 70 }} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="승인 조건이나 반려 사유를 적어주세요" />
                  </label>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-d" disabled={decide.isPending} onClick={() => onDecide('rejected')}>
                      반려
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        consoleApi.requestMoreInfo(cur.id).then(() => {
                          qc.invalidateQueries({ queryKey: qk.adminLog });
                          toast(`${cur.user}님에게 추가 설명을 요청했어요`);
                        })
                      }
                    >
                      정보 추가 요청
                    </button>
                    <button type="button" className="btn btn-p" disabled={decide.isPending} onClick={() => onDecide('approved')}>
                      승인 · {TTL_KO[ttl]}
                    </button>
                  </div>
                </>
              ) : (
                <div className="note-box t2">
                  {cur.status === 'approved' ? `승인됨 · ${cur.ttl ? TTL_KO[cur.ttl] : ''} 허용` : cur.status === 'rejected' ? '반려됨' : '허용 기간이 끝나 자동으로 회수됐어요'}
                  {cur.memo ? ` · 메모: ${cur.memo}` : ''}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
