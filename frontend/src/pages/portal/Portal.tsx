// 내 예외 요청 · 도움말. Opened from the extension's "내 예외 요청". Everything here is real: the requests this browser sent
// (found by the id the extension and this page share, ?cid=) and what the admin decided. The gateway has no per-user records,
// so there is no personal "protection summary" page.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { portalApi } from '../../api/console';
import type { PortalRequest } from '../../api/consoleTypes';
import { Icon } from '../../components/Icon';
import { GrantTime } from '../../components/GrantTime';
import { QueryState } from '../../components/QueryState';
import { qk } from '../../features/queries';
import './portal.css';

const REQ_CLS: Record<PortalRequest['status'], string> = { PENDING: 'b-accent', APPROVED: 'b-clean', REJECTED: 'b-block' };
const STATUS_KO: Record<PortalRequest['status'], string> = { PENDING: '대기', APPROVED: '승인', REJECTED: '반려' };
const FAQ = [
  ['왜 전송이 막혔나요?', 'API 키·비밀번호 같은 시크릿과 주민등록번호처럼 가려도 위험한 정보는 아예 보내지 않아요. 입력한 글은 그대로 남아 있으니 그 부분만 지우고 다시 보내면 돼요. 꼭 필요하면 예외 요청을 보내세요.'],
  ['예외 요청을 하면 어떻게 되나요?', '보안관리자가 사유를 보고 기간(1회 · 1시간 · 24시간 · 7일)을 정해 승인하거나, 메모와 함께 반려해요. 결과는 채팅 화면에 팝업으로 알려 드려요. 승인되면 입력창 왼쪽에 남은 시간이 보이고, 누르면 어떤 항목이 허용됐는지 볼 수 있어요. 1회 허용은 쓰는 즉시 사라져요.'],
  ['답변에 [사람_1] 같은 글자가 그대로 보여요', '원래 값은 이 탭에만 최대 1시간 기억돼요. 시간이 지났거나 탭을 새로 열면 복원할 수 없어 자리표시자로 보여요. 모델이 자리표시자를 안 쓰고 답하면 복원할 게 없으니 "자리표시자를 그대로 써서 답해줘"라고 덧붙여 보세요.'],
  ['보안팀이 내가 쓴 내용을 볼 수 있나요?', '아니요. 서버에는 언제, 어느 사이트에, 어떤 종류의 정보가 몇 개 있었는지만 남아요. 프롬프트 원문과 원래 값은 서버에 저장되지 않아서 관리자도 볼 수 없어요.'],
  ['한글을 치다가 Enter를 눌렀는데 안 보내져요', '한글 조합 중에 누른 Enter는 글자를 확정하는 데만 쓰고 전송하지 않아요. 한 번 더 Enter를 누르면 검사 후 전송돼요.'],
  ['보호를 끌 수 있나요?', '팝업에서 끌 수 있지만, 끈 동안 보낸 내용은 검사되지 않아요.'],
];

export function PortalNav({ tab, onTab }: { tab?: number; onTab?: (i: number) => void }) {
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
          {['내 예외 요청', '도움말'].map((l, i) => (
            <button key={l} type="button" aria-pressed={tab === i} onClick={() => onTab(i)}>
              {l}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

export function PortalPage() {
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState(0);
  const requests = useQuery({ queryKey: qk.portal('requests'), queryFn: portalApi.requests, refetchInterval: 5_000 });

  return (
    <div className="page-bg portal">
      <PortalNav tab={tab} onTab={setTab} />
      <main className="portal-main" style={{ maxWidth: 1240 }}>
        {tab === 0 && (
          <>
            <div className="page-head">
              <div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>내 예외 요청</h1>
                <p className="t2" style={{ margin: '6px 0 0', fontSize: 14 }}>
                  막힌 전송을 꼭 보내야 할 때 보안팀에 요청한 내역이에요. 이 브라우저에서 보낸 요청만 보여요.
                </p>
              </div>
              <Link className="btn btn-p" to="/me/request">
                새 예외 요청
              </Link>
            </div>
            <QueryState isLoading={requests.isLoading} error={requests.error} />
            {requests.data && requests.data.length === 0 && <div className="empty">보낸 예외 요청이 없어요</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 16 }}>
              {requests.data?.map((q) => (
                <article key={q.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="mono t3" style={{ fontSize: 12.5 }}>
                      {q.id}
                    </span>
                    <span className={`badge ${REQ_CLS[q.status]}`}>{STATUS_KO[q.status]}</span>
                  </div>
                  <h2 style={{ margin: 0, fontSize: 15 }}>{q.title}</h2>
                  <div className="t2" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                    {q.note}
                  </div>
                  <GrantTime request={q} />
                  <div className="t3" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
                    <span>{q.when}</span>
                    <span>·</span>
                    <span>{q.scope}</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {tab === 1 && (
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
                    <p id={`faq-${i}`} className="t2" style={{ margin: 0, padding: '6px 16px 14px', fontSize: 14, lineHeight: 1.75 }}>
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
