// Shown when the gateway answers 401: GATEWAY_ADMIN_TOKEN is set on the server and this tab has no token.
// The token is kept in sessionStorage only (never in the bundle or localStorage).
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { adminToken } from '../../api/client';
import { useFeedback } from '../../features/feedback';

export function TokenPage() {
  const [value, setValue] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const from = (loc.state as { from?: string } | null)?.from ?? '/console';
  const has = !!adminToken.get();

  function submit(e: FormEvent) {
    e.preventDefault();
    adminToken.set(value.trim());
    setValue('');
    qc.invalidateQueries({ queryKey: ['gw'] });
    toast('토큰을 이 탭에만 저장했어요 · 탭을 닫으면 지워져요');
    nav(from, { replace: true });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">설정 / 관리자 토큰</div>
          <h1>관리자 토큰이 필요해요</h1>
          <p className="t2">검사 서버에 GATEWAY_ADMIN_TOKEN이 설정돼 있어 통계·기록을 보려면 토큰이 있어야 해요.</p>
        </div>
      </header>
      <section className="card" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            <span>X-Admin-Token</span>
            <input className="in mono" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="서버 관리자에게 받은 토큰" required />
          </label>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {has && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  adminToken.set('');
                  qc.invalidateQueries({ queryKey: ['gw'] });
                  toast('저장한 토큰을 지웠어요');
                }}
              >
                저장한 토큰 지우기
              </button>
            )}
            <button type="submit" className="btn btn-p" disabled={!value.trim()}>
              저장하고 다시 시도
            </button>
          </div>
        </form>
        <div className="note-box t2">
          토큰은 이 브라우저 탭(sessionStorage)에만 두고 빌드 결과물이나 다른 저장소에는 넣지 않아요. 개발 중에는 <span className="mono">GATEWAY_ADMIN_TOKEN</span>을 설정한 셸에서{' '}
          <span className="mono">npm run dev</span>를 실행하면 dev 서버 proxy가 대신 붙여 줘서 이 화면이 나오지 않아요.
        </div>
      </section>
    </>
  );
}
