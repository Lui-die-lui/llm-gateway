// U7 전체 보기 · 내 보호 현황 (UserPortal.dc.html). Opened from the extension's "전체 보기". Mock data:
// the gateway has no per-user records (the audit log has no user column).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../../api/console';
import type { PortalRecent, PortalRequest } from '../../api/consoleTypes';
import { Icon } from '../../components/Icon';
import { GrantTime } from '../../components/GrantTime';
import { QueryState } from '../../components/QueryState';
import { qk } from '../../features/queries';
import './portal.css';

const RESULT: Record<PortalRecent['result'], [string, string]> = { redact: ['b-redact', '가림'], block: ['b-block', '차단'], clean: ['b-clean', '통과'], file: ['b-accent', '가린 사본'] };
const REQ_CLS: Record<PortalRequest['status'], string> = { PENDING: 'b-accent', APPROVED: 'b-clean', REJECTED: 'b-block' };
const FAQ = [
  ['왜 전송이 막혔나요?', 'API 키·비밀번호 같은 시크릿과 주민등록번호처럼 가려도 위험한 정보는 아예 보내지 않아요. 입력한 글은 그대로 남아 있으니 그 부분만 지우고 다시 보내면 돼요. 꼭 필요하면 예외 요청을 보내세요.'],
  ['답변에 [사람_1] 같은 글자가 그대로 보여요', '원래 값은 이 탭에 30분 동안만 보관돼요. 시간이 지났거나 탭을 새로 열면 복원할 수 없어 자리표시자로 보여요. 모델이 자리표시자를 안 쓰고 답하면 복원할 게 없으니 "자리표시자를 그대로 써서 답해줘"라고 덧붙여 보세요.'],
  ['보안팀이 내가 쓴 내용을 볼 수 있나요?', '아니요. 서버에는 언제, 어느 사이트에, 어떤 종류의 정보가 몇 개 있었는지만 남아요. 프롬프트 원문과 원래 값은 어디에도 저장되지 않아서 관리자도 볼 수 없어요.'],
  ['파일은 어떻게 검사되나요?', '파일을 올리면 사이트에 가기 전에 회사 게이트웨이 서버가 내용을 읽고, 민감정보를 가린 사본을 만들어 그 사본만 올려요. 암호가 걸렸거나 25MB를 넘거나 HWP·ZIP처럼 읽을 수 없는 파일은 올리지 않아요.'],
  ['한글을 치다가 Enter를 눌렀는데 안 보내져요', '한글 조합 중에 누른 Enter는 글자를 확정하는 데만 쓰고 전송하지 않아요. 한 번 더 Enter를 누르면 검사 후 전송돼요.'],
  ['보호를 끌 수 있나요?', '팝업에서 끌 수 있지만, 끈 동안 보낸 내용은 검사되지 않아요. 회사 정책에 따라 끄기가 잠겨 있을 수 있어요.'],
];
const TYPES: [string, number, string][] = [
  ['조성비', 14, '#DC2626'],
  ['원료 공급처', 4, '#2563EB'],
  ['이름', 3, '#D97706'],
  ['이메일', 2, '#D97706'],
  ['계좌번호', 1, '#DC2626'],
];

export function PortalNav({ tab, onTab }: { tab?: number; onTab?: (i: number) => void }) {
  const profile = useQuery({ queryKey: qk.portal('profile'), queryFn: portalApi.profile });
  return (
    <nav aria-label="사용자 포털" className="portal-nav">
      <Link to="/me" style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>
        <span className="sb-logo">
          <Icon name="shield" size={16} stroke="#fff" width={2.2} />
        </span>
        Gateway
      </Link>
      {onTab && (
        <div className="seg" role="group" aria-label="포털 메뉴">
          {['내 현황', '내 예외 요청', '도움말'].map((l, i) => (
            <button key={l} type="button" aria-pressed={tab === i} onClick={() => onTab(i)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
        <span className="av" style={{ width: 32, height: 32, background: '#DBE4FF' }}>
          {profile.data?.name.slice(0, 1)}
        </span>
        {profile.data ? `${profile.data.name} · ${profile.data.dept}` : '…'}
      </span>
    </nav>
  );
}

export function PortalPage() {
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState(0);
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: qk.portal('profile'), queryFn: portalApi.profile });
  const recent = useQuery({ queryKey: qk.portal('recent'), queryFn: portalApi.recent });
  const requests = useQuery({ queryKey: qk.portal('requests'), queryFn: portalApi.requests, refetchInterval: 5_000 });
  const flag = useMutation({ mutationFn: portalApi.flagRecent, onSuccess: () => qc.invalidateQueries({ queryKey: qk.portal('recent') }) });

  const p = profile.data;

  return (
    <div className="page-bg portal">
      <PortalNav tab={tab} onTab={setTab} />
      <main className="portal-main" style={{ maxWidth: 1240 }}>
        <div className="portal-hint">
          <span className="t2">
            <span className="lbl" style={{ marginRight: 8 }}>
              열리는 곳
            </span>
            채팅창 치환 내역 패널(▴) 또는 확장 팝업에서 <b style={{ color: 'var(--ink)' }}>"전체 보기"</b>를 누르면 새 탭으로 열려요
          </span>
          <Link to="/me/history" style={{ fontWeight: 600 }}>
            치환 기록 자세히 →
          </Link>
        </div>

        {tab === 0 && (
          <>
            <div className="page-head">
              <div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>안녕하세요, {p?.name ?? '…'}님</h1>
                <p className="t2" style={{ margin: '6px 0 0', fontSize: 13.5 }}>
                  이번 주에 Gateway가 내 대신 가려준 것들이에요. 원래 단어는 홍*동처럼 일부만, 이 기기에만 7일 남아요.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderRadius: 999, background: 'rgba(16,185,129,.12)', color: '#065F46', fontSize: 12.5, fontWeight: 600 }}>
                <i style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981' }} />
                확장 정상 · {p?.extension} · 정책 rev.{p?.policyRev}
              </div>
            </div>
            <section aria-label="이번 주" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
              {[
                ['이번 주 검사', '128', '하루 평균 25건', 'var(--ink)'],
                ['가려서 보냄', '23', '전송은 모두 성공', '#B45309'],
                ['막힌 전송', '1', 'API 키 · 화요일', '#B91C1C'],
                ['가린 파일', '4', 'PDF 3 · XLSX 1', '#1D4ED8'],
              ].map(([l, v, n, c]) => (
                <div key={l} className="card" style={{ padding: 18 }}>
                  <div className="lbl">{l}</div>
                  <div className="mono" style={{ fontSize: 30, fontWeight: 600, marginTop: 8, color: c }}>
                    {v}
                  </div>
                  <div className="t3" style={{ fontSize: 12, marginTop: 4 }}>
                    {n}
                  </div>
                </div>
              ))}
            </section>
            <div className="row-wrap">
              <section className="card" style={{ flex: '1 1 360px' }}>
                <h2 style={{ margin: '0 0 14px', fontSize: 15 }}>자주 가려진 항목</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {TYPES.map(([n, v, c]) => (
                    <div key={n} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 30px', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                      <span>{n}</span>
                      <div className="bar" role="img" aria-label={`${n} ${v}건`}>
                        <i style={{ width: `${Math.round((v / 14) * 100)}%`, background: c }} />
                      </div>
                      <span className="mono t2" style={{ textAlign: 'right' }}>
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="t3" style={{ fontSize: 12, margin: '14px 0 0', lineHeight: 1.6 }}>
                  조성비가 가장 많아요. 배합 비율이 꼭 필요하지 않은 요청이면 "A 원료 비율"처럼 적으면 가림 없이 더 자연스러운 답을 받아요.
                </p>
              </section>
              <section className="card" style={{ flex: '2 1 520px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0, fontSize: 15 }}>최근 기록</h2>
                  <Link to="/me/history" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    무엇이 무엇으로 바뀌었는지 자세히 →
                  </Link>
                </div>
                <QueryState isLoading={recent.isLoading} error={recent.error} />
                <div className="tbl">
                  <table>
                    <thead>
                      <tr>
                        <th>TIME</th>
                        <th>SITE</th>
                        <th>WHAT</th>
                        <th>RESULT</th>
                        <th>
                          <span className="sr-only">오탐 신고</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.data?.map((r) => (
                        <tr key={r.id}>
                          <td className="mono t3" style={{ fontSize: 12 }}>
                            {r.t}
                          </td>
                          <td>{r.site}</td>
                          <td className="t2">{r.what}</td>
                          <td>
                            <span className={`badge ${RESULT[r.result][0]}`}>{RESULT[r.result][1]}</span>
                          </td>
                          <td>
                            <button type="button" className="btn" style={{ minHeight: 30, fontSize: 11.5 }} aria-pressed={r.flagged} aria-label={`${r.t} ${r.what} ${r.flagged ? '오탐 신고 취소' : '오탐 신고'}`} onClick={() => flag.mutate(r.id)}>
                              {r.flagged ? '신고함' : '오탐 신고'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </>
        )}

        {tab === 1 && (
          <>
            <div className="page-head">
              <div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>내 예외 요청</h1>
                <p className="t2" style={{ margin: '6px 0 0', fontSize: 13.5 }}>
                  막힌 전송을 꼭 보내야 할 때 보안팀에 요청한 내역이에요.
                </p>
              </div>
              <Link className="btn btn-p" to="/me/request">
                새 예외 요청
              </Link>
            </div>
            <QueryState isLoading={requests.isLoading} error={requests.error} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
              {requests.data?.map((q) => (
                <article key={q.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="mono t3" style={{ fontSize: 11.5 }}>
                      {q.id}
                    </span>
                    <span className={`badge ${REQ_CLS[q.status]}`}>{q.status}</span>
                  </div>
                  <h2 style={{ margin: 0, fontSize: 15 }}>{q.title}</h2>
                  <div className="t2" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                    {q.note}
                  </div>
                  <GrantTime request={q} />
                  <div className="t3" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11.5 }}>
                    <span>{q.when}</span>
                    <span>·</span>
                    <span>{q.scope}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {tab === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>자주 묻는 질문</h1>
            {FAQ.map(([q, a], i) => {
              const o = open === i;
              return (
                <div key={q} className="card" style={{ padding: 6 }}>
                  <button type="button" className="faq" aria-expanded={o} aria-controls={`faq-${i}`} onClick={() => setOpen(o ? -1 : i)}>
                    <span>{q}</span>
                    <span aria-hidden="true">{o ? '−' : '+'}</span>
                  </button>
                  {o && (
                    <p id={`faq-${i}`} className="t2" style={{ margin: 0, padding: '6px 16px 14px', fontSize: 13, lineHeight: 1.75 }}>
                      {a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
