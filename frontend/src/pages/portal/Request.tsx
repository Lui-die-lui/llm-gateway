// U9 예외 요청하기 (UserRequest.dc.html). Submitting creates a pending request in the mock store, which then shows
// up in the admin console's 06 예외 요청 and in 내 예외 요청.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { useFeedback } from '../../features/feedback';
import { qk } from '../../features/queries';
import { PortalNav } from './Portal';
import './portal.css';

const SCOPES = [
  ['1회', '1회만', '이번 전송 한 번'],
  ['1시간', '1시간', '같은 항목 · 같은 사이트'],
  ['24시간', '24시간', '같은 항목 · 하루 동안'],
] as const;
type Scope = (typeof SCOPES)[number][0];

export function RequestPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useFeedback();
  const blocked = useQuery({ queryKey: qk.portal('blocked'), queryFn: portalApi.lastBlocked });
  // The extension's block dialog opens this page with what it blocked and where; without it the card shows the sample.
  const [params] = useSearchParams();
  const labels = params.get('labels') ?? '';
  const site = params.get('site') ?? '';
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<Scope>('1회');
  const [agree, setAgree] = useState(false);
  const submit = useMutation({
    mutationFn: () => portalApi.createException({ reason, scope, requester: name, entity: labels, site }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.portal('requests') });
      qc.invalidateQueries({ queryKey: qk.exceptions });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const len = reason.trim().length;
  const can = len >= 20 && agree;
  const done = submit.data;

  return (
    <div className="page-bg portal">
      <PortalNav />
      <main className="portal-main" style={{ maxWidth: 1100 }}>
        <div>
          <Link to="/me" style={{ fontSize: 12.5 }}>
            ← 내 보호 현황
          </Link>
          <h1 style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 700, letterSpacing: '-.02em' }}>예외 요청하기</h1>
          <p className="t2" style={{ margin: '6px 0 0', fontSize: 13.5 }}>
            막힌 내용을 원래 모습으로 보내야 하는 이유를 알려주세요. 보안팀이 확인 후 정한 기간에만 허용돼요.
          </p>
        </div>
        <div className="row-wrap top" style={{ gap: 18 }}>
          {!done ? (
            <form
              className="card"
              style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 20, padding: 22 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (can) submit.mutate();
              }}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 14, borderRadius: 16, background: 'rgba(220,38,38,.07)', border: '1px solid rgba(220,38,38,.2)' }}>
                <span style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(220,38,38,.12)', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                  <Icon name="ban" stroke="#DC2626" width={2.2} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                    {labels ? `막힌 전송 · ${site || '브라우저 확장'}` : `막힌 전송 · ${blocked.data?.when ?? '…'} · ${blocked.data?.site ?? ''}`}
                  </span>
                  <span className="t2" style={{ fontSize: 12.5 }}>
                    {labels ? `${labels.split(',').join(' · ')} — 항목 종류만 전달돼요` : blocked.data?.summary}
                  </span>
                </span>
              </div>
              <label className="field">
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-body)' }}>
                  이름{' '}
                  <span className="t3" style={{ fontWeight: 400 }}>
                    (선택 · 보안관리자 화면에 표시돼요)
                  </span>
                </span>
                <input className="in-lg" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="예: 김민지" />
              </label>
              <label className="field">
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-body)' }}>
                  왜 원래 값 그대로 보내야 하나요?{' '}
                  <span className="t3" style={{ fontWeight: 400 }}>
                    (필수 · 20자 이상)
                  </span>
                </span>
                <textarea
                  className="in-lg"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-describedby="reason-count"
                  placeholder="예: 해외 OEM에 보낼 배합 변경 요청서를 번역해야 하는데, 자리표시자로 가리면 수치가 빠져 수작업으로 다시 넣어야 합니다."
                />
                <span id="reason-count" className="t3" style={{ fontSize: 11.5 }} aria-live="polite">
                  {len < 20 ? `${20 - len}자 더 적어주세요` : `좋아요 · ${len}자`}
                </span>
              </label>
              <div className="field">
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-body)' }}>얼마 동안 필요하세요?</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }} role="group" aria-label="필요한 기간">
                  {SCOPES.map(([v, l, sub]) => (
                    <button key={v} type="button" className="opt" aria-pressed={scope === v} onClick={() => setScope(v)}>
                      <b style={{ fontSize: 13.5 }}>{l}</b>
                      <span className="t3" style={{ fontSize: 11.5 }}>
                        {sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.6, cursor: 'pointer' }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 18, height: 18, margin: '2px 0 0', accentColor: 'var(--accent)' }} />
                <span>요청 사유와 처리 결과가 보안팀 기록에 남는다는 것을 알고 있어요. 승인돼도 내가 보낸 내용 자체는 저장되지 않아요.</span>
              </label>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-lg" onClick={() => nav('/me')}>
                  취소
                </button>
                <button type="submit" className="btn btn-p btn-lg" disabled={!can || submit.isPending}>
                  요청 보내기
                </button>
              </div>
            </form>
          ) : (
            <section className="card" style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 18, padding: 22 }} aria-live="polite">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(16,185,129,.14)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="check" size={20} stroke="#047857" width={2.4} />
                </span>
                <span>
                  <b style={{ display: 'block', fontSize: 17 }}>요청을 보냈어요</b>
                  <span className="mono t3" style={{ fontSize: 12 }}>
                    {done.id} · {scope}
                  </span>
                </span>
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  ['1', '요청 접수', '방금 · 사유와 막힌 항목 종류만 전달돼요', 'rgba(16,185,129,.16)', '#047857'],
                  ['2', '보안관리자 결정', '보안관리자 한 명이 사유를 보고 정해요 · 보통 2시간 안 · 알림으로 알려드려요', 'rgba(37,99,235,.12)', '#1D4ED8'],
                  ['3', '허용 기간 동안 전송 가능', '기간이 끝나면 자동으로 다시 보호돼요', 'rgba(15,26,43,.07)', '#4A5568'],
                ].map(([n, t, s, bg, fg]) => (
                  <li key={n} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
                    <span className="mono" style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, background: bg, color: fg }}>
                      {n}
                    </span>
                    <span>
                      <b style={{ fontSize: 13.5 }}>{t}</b>
                      <span className="t3" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                        {s}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link className="btn btn-p btn-lg" to="/me">
                  내 요청 보기
                </Link>
                <button
                  type="button"
                  className="btn btn-lg"
                  onClick={() => {
                    submit.reset();
                    setReason('');
                    setAgree(false);
                  }}
                >
                  다시 작성
                </button>
              </div>
            </section>
          )}
          <aside className="card" style={{ flex: '2 1 320px', display: 'flex', flexDirection: 'column', gap: 14, padding: 22 }}>
            <div className="lbl">먼저 이것도 해 보세요</div>
            <div style={{ padding: 14, borderRadius: 16, background: 'rgba(255,255,255,.7)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <b style={{ fontSize: 14 }}>가린 채로 보내고 복원 받기</b>
              <span className="t2" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                답변에 자리표시자가 그대로 쓰이면 화면에서 원래 값으로 바뀌어 보여요. "자리표시자를 그대로 써서"라고 요청에 덧붙여 보세요.
              </span>
            </div>
            <div className="t3" style={{ fontSize: 12, lineHeight: 1.6 }}>
              API 키·주민등록번호 같은 critical 항목은 예외 요청을 받지 않아요.
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
