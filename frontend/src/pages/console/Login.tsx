// P2 관리자 콘솔 로그인 (AdminLogin.dc.html). Mock account: admin@example.com / test1234.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../features/auth';
import { useFeedback } from '../../features/feedback';
import './login.css';

type View = 'form' | 'otp' | 'done' | 'expired';
type Err = { kind: 'wrong'; remaining: number } | { kind: 'locked'; until: string } | { kind: 'notadmin' } | null;

const REMEMBER_KEY = 'gw.console.rememberId';

function remembered(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

const ERR_TEXT = {
  wrong: (n: number) => ({ t: '아이디 또는 비밀번호가 맞지 않아요', d: `남은 시도 ${n}번 · 5번 틀리면 15분 동안 잠겨요.`, tone: 'wrong' }),
  locked: (until: string) => ({ t: '계정이 15분 동안 잠겼어요', d: `비밀번호를 5번 틀렸어요. 보안 담당자에게 알림이 갔어요. ${until} 다시 시도하세요.`, tone: 'locked' }),
  notadmin: () => ({ t: '관리자 권한이 없는 계정이에요', d: '비밀번호는 맞지만 이 계정은 일반 사용자예요. 권한이 필요하면 보안 담당자에게 요청하세요. 이 시도도 기록돼요.', tone: 'notadmin' }),
};

export function LoginPage() {
  const [params] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { session, signIn, expired } = useAuth();
  const { toast } = useFeedback();
  const from = (loc.state as { from?: string } | null)?.from ?? '/console';

  const [view, setView] = useState<View>(params.get('expired') || expired ? 'expired' : 'form');
  const [id, setId] = useState(remembered);
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(() => !!remembered());
  const [err, setErr] = useState<Err>(null);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [otpErr, setOtpErr] = useState(false);
  const otpInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [view]);

  // Already signed in (e.g. opened /login in a second tab): skip straight to the console.
  useEffect(() => {
    if (session && view === 'form') nav(from, { replace: true });
  }, [session, view, nav, from]);

  const locked = err?.kind === 'locked';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (locked || busy) return;
    setBusy(true);
    try {
      const r = await consoleApi.login(id, pw);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, id.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* ignore */
      }
      if (r.kind === 'ok') {
        setErr(null);
        signIn(r.user, r.lastLogin);
        setView('done');
      } else if (r.kind === 'otp') {
        setErr(null);
        setTicket(r.ticket);
        setCode('');
        setView('otp');
      } else {
        setErr(r);
        setPw('');
      }
    } catch (e2) {
      toast(errorMessage(e2), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (code.length < 6) {
      setOtpErr(true);
      return;
    }
    const r = await consoleApi.verifyOtp(ticket, code);
    if (r.kind === 'ok') {
      signIn(r.user, r.lastLogin);
      setView('done');
    } else {
      setOtpErr(true);
      setCode('');
      otpInput.current?.focus();
    }
  }

  function back() {
    setView('form');
    setErr(null);
    setPw('');
    setCode('');
  }

  const errText = err ? (err.kind === 'wrong' ? ERR_TEXT.wrong(err.remaining) : err.kind === 'locked' ? ERR_TEXT.locked(err.until) : ERR_TEXT.notadmin()) : null;

  return (
    <div className="login page-bg">
      <header className="page-head">
        <div>
          <div className="lbl">LOGIN · 관리자 콘솔</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-.02em' }}>로그인 · 관리자 콘솔</h1>
          <p className="t2" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
            관리자 콘솔(웹) 전용 로그인이에요. 확장 로그인과 따로 있어요. 확장에서 회사를 등록한 관리자 계정, 또는 관리자로 지정된 계정만 들어올 수 있어요.
          </p>
        </div>
      </header>

      <div className="login-grid">
        <section className="glass login-hero" aria-label="콘솔 안내">
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, background: '#fff', display: 'grid', placeItems: 'center' }}>
              <Icon name="shield" size={20} stroke="#0F1A2B" width={2.2} />
            </span>
            <span>
              <b style={{ display: 'block', fontSize: 18 }}>Gateway Security Console</b>
              <span className="mono" style={{ fontSize: 12, opacity: 0.7 }}>
                admin.gateway.example.com
              </span>
            </span>
          </span>
          <h2 style={{ margin: '12px 0 0', fontSize: 30, lineHeight: 1.35, fontWeight: 700, letterSpacing: '-.02em' }}>
            정책과 기록을 다루는 곳이라
            <br />
            관리자만 들어와요
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13.5, lineHeight: 1.65, opacity: 0.92 }}>
            <div>· 관리자 권한이 있는 계정만 들어올 수 있어요. 일반 직원 계정은 비밀번호가 맞아도 막혀요.</div>
            <div>· 비밀번호를 5번 틀리면 15분 동안 잠기고, 보안 담당자에게 알림이 가요.</div>
            <div>· 30분 동안 아무것도 안 하면 자동으로 로그아웃돼요.</div>
            <div>· 로그인·로그아웃·실패 기록은 모두 감사 로그에 남아요.</div>
          </div>
          <div style={{ marginTop: 'auto', fontSize: 12.5, opacity: 0.65 }}>테스트용 가짜 계정만 쓰세요 · 실제 사번이나 비밀번호를 넣지 마세요</div>
        </section>

        <section className="glass login-box" aria-label="로그인">
          {view === 'form' && (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
              <div>
                <div className="lbl">1단계 · 계정 확인</div>
                <h2 ref={heading} tabIndex={-1} style={{ margin: '6px 0 0', fontSize: 22, outline: 'none' }}>
                  관리자 계정으로 로그인
                </h2>
              </div>
              {errText && (
                <div role="alert" className={`login-err ${errText.tone}`}>
                  <b style={{ display: 'block' }}>{errText.t}</b>
                  {errText.d}
                </div>
              )}
              <label className="login-field">
                아이디 (회사 이메일)
                <input type="email" value={id} onChange={(e) => setId(e.target.value)} placeholder="admin@example.com" autoComplete="username" required />
              </label>
              <label className="login-field">
                비밀번호
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
              </label>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />이 기기 기억 (아이디만)
                </label>
                <button type="button" className="link-btn" style={{ fontSize: 13.5, fontWeight: 400 }} onClick={() => toast('재설정 메일은 서버 연동 후 보낼 수 있어요 (지금은 mock 계정만)')}>
                  비밀번호 재설정
                </button>
              </div>
              <button type="submit" className="btn btn-p login-btn" disabled={locked || busy}>
                {locked ? '잠김 · 15분 뒤 다시 시도' : busy ? '확인 중…' : '다음'}
              </button>
              <div className="t3" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                시험해 보기: 아이디 admin@example.com · 비밀번호 test1234. 다른 값을 넣으면 실패 화면을 볼 수 있어요.
              </div>
            </form>
          )}

          {view === 'otp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="lbl">추가 확인 · 관리자가 2단계 인증을 켰을 때만</div>
                <h2 ref={heading} tabIndex={-1} style={{ margin: '6px 0 0', fontSize: 22, outline: 'none' }}>
                  인증 앱의 6자리 숫자
                </h2>
                <p className="t2" style={{ margin: '6px 0 0', fontSize: 13.5 }}>
                  {id} 계정 · Google Authenticator 같은 인증 앱에서 확인하세요.
                </p>
              </div>
              <label className="sr-only" htmlFor="otp-code">
                인증 번호 6자리
              </label>
              <input
                id="otp-code"
                ref={otpInput}
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setOtpErr(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && verify()}
              />
              <div className="otp" aria-hidden="true" onClick={() => otpInput.current?.focus()}>
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className={i === code.length ? 'cur' : ''}>
                    {code[i] ? '•' : ''}
                  </span>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6 }}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="btn login-key"
                    onClick={() => {
                      if (code.length < 6) setCode(code + k);
                      setOtpErr(false);
                    }}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {otpErr && (
                <div role="alert" className="login-err wrong" style={{ fontSize: 13.5 }}>
                  숫자가 맞지 않아요. 앱의 숫자는 30초마다 바뀌어요.
                </div>
              )}
              <button type="button" className="btn btn-p login-btn" onClick={verify}>
                확인하고 콘솔 열기
              </button>
              <div className="t3" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                2단계 인증이 꺼져 있으면 이 화면은 나오지 않고 바로 콘솔로 가요.
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                <button type="button" className="link-btn" style={{ fontSize: 13.5, padding: '6px 0' }} onClick={back}>
                  ← 다른 계정
                </button>
                <span className="t3">휴대폰을 잃어버렸다면 복구 코드 사용</span>
              </div>
              <div className="t3" style={{ fontSize: 12.5 }}>
                시험해 보기: 아무 6자리 · 000000을 넣으면 실패
              </div>
            </div>
          )}

          {view === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
              <span style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(16,185,129,.14)', display: 'grid', placeItems: 'center' }}>
                <Icon name="check" size={26} stroke="#047857" width={2.4} />
              </span>
              <h2 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 22, outline: 'none' }}>
                확인됐어요 · {session?.user.name ?? '보안관리자'}
              </h2>
              <p className="t2" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>
                환영해요. 아래 버튼으로 콘솔을 열어 주세요.
              </p>
              <button type="button" className="btn btn-p login-btn" onClick={() => nav(from, { replace: true })}>
                관리자 콘솔 열기 →
              </button>
            </div>
          )}

          {view === 'expired' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="lbl">세션 만료</div>
              <h2 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 22, outline: 'none' }}>
                30분 동안 활동이 없어 로그아웃됐어요
              </h2>
              <p className="t2" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>
                정책 편집 중이던 내용은 임시 저장돼 있어요. 다시 로그인하면 이어서 할 수 있어요.
              </p>
              <button type="button" className="btn btn-p login-btn" onClick={back}>
                다시 로그인
              </button>
            </div>
          )}

          <div className="login-foot">
            <span>회사가 아직 없나요? 확장에서 회사를 등록하세요</span>
            <span className="t3">문의 · security@example.com</span>
          </div>
        </section>
      </div>

      <section className="glass login-notes" aria-label="보안 규칙">
        <div className="note">
          <i>1</i>
          <span>
            <b>로그인이 두 개인 이유</b>
            <br />
            확장은 직원이 쓰는 보호 도구이고, 콘솔은 정책과 예외 요청을 다루는 관리자용이에요. 콘솔은 권한이 커서 따로 확인해요.
          </span>
        </div>
        <div className="note">
          <i>2</i>
          <span>
            <b>2단계 인증은 선택</b>
            <br />
            기본은 꺼져 있어요. 회사 기준에 따라 관리자가 설정에서 켜면 인증 앱 6자리를 추가로 물어요.
          </span>
        </div>
        <div className="note">
          <i>3</i>
          <span>
            <b>실패와 잠금</b>
            <br />
            5번 틀리면 15분 잠김. 같은 IP에서 계속 실패하면 보안 담당자에게 알려요.
          </span>
        </div>
        <div className="note">
          <i>4</i>
          <span>
            <b>접속 위치 제한</b>
            <br />
            설정에서 회사 네트워크(IP)에서만 열리게 할 수 있어요.
          </span>
        </div>
      </section>
    </div>
  );
}
