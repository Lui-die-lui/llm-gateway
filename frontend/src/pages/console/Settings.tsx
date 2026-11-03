// Settings: the gateway's real state, read from GET /v1/settings. Nothing here is a made-up switch: what the server is set up with
// (environment variables on the server) is shown as it is, and the one thing the console can do, send a Slack test line, really sends.
import { type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { useServerSettings, useSettings } from '../../features/queries';
import './settings.css';

function Row({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="row-line">
      <div>
        <div style={{ fontSize: 14 }}>{title}</div>
        {sub && (
          <div className="t3" style={{ fontSize: 13, marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>{children}</div>
    </div>
  );
}

const Status = ({ on, yes, no, warn }: { on: boolean; yes: string; no: string; warn?: boolean }) => (
  <span className={`badge ${on ? 'b-clean' : warn ? 'b-block' : 'b-muted'}`}>{on ? yes : no}</span>
);

const SECTIONS: [string, string][] = [
  ['protect', '보호 상태'],
  ['keep', '보관 · 유효 시간'],
  ['slack', 'Slack 연동'],
  ['console', '콘솔'],
];

function duration(sec: number) {
  if (sec % 86400 === 0) return `${sec / 86400}일`;
  if (sec % 3600 === 0) return `${sec / 3600}시간`;
  return `${Math.round(sec / 60)}분`;
}

export function SettingsPage() {
  const q = useServerSettings();
  const local = useSettings();
  const { toast } = useFeedback();
  const test = useMutation({
    mutationFn: consoleApi.slackTest,
    onSuccess: (r) => toast(r.message, r.ok ? 'ok' : 'error'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const s = q.data;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">시스템 / 설정</div>
          <h1>설정</h1>
          <p className="t2">검사 서버가 지금 실제로 이렇게 설정돼 있어요 · 값은 서버 환경변수로 바꿔요 (docs/DEPLOY.md)</p>
        </div>
      </header>

      {!s ? (
        <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="row-wrap top">
          <nav className="snav card" aria-label="설정 섹션">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
          <div style={{ flex: '4 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section id="protect" className="card set-sec">
              <h2 className="ct">보호 상태</h2>
              <p className="sub">누가 이 서버를 쓸 수 있고, 무엇을 검사하는지예요.</p>
              <Row title="접속 키 (사용 앱 인증)" sub={s.protection.caller_auth ? `키 ${s.protection.caller_keys}개 등록됨 · 키 없이는 가림·복원을 쓸 수 없어요` : '키가 없어도 누구나 가림·복원을 쓸 수 있어요 · 배포 서버에는 GATEWAY_API_KEYS를 설정하세요'}>
                <Status on={s.protection.caller_auth} yes="필요" no="열려 있음" warn />
              </Row>
              <Row title="관리자 토큰" sub={s.protection.admin_protected ? '통계·기록·정책은 토큰이 있어야 볼 수 있어요' : '통계·기록·정책을 누구나 볼 수 있어요 · 배포 서버에는 GATEWAY_ADMIN_TOKEN을 설정하세요'}>
                <Status on={s.protection.admin_protected} yes="보호됨" no="열려 있음" warn />
              </Row>
              <Row title="답변 검사" sub="AI가 돌려준 답에서도 민감 정보를 찾아요">
                <Status on={s.protection.response_scan} yes="켜짐" no="꺼짐" warn />
              </Row>
              <Row title="한 번에 검사하는 글자 수" sub="이보다 길면 거절해요">
                <span className="mono">{s.protection.max_text.toLocaleString('ko-KR')}자</span>
              </Row>
              <Row title="AI 연결" sub={s.upstream.mock ? '실제 AI 대신 가짜 답을 돌려주는 개발용 모드예요' : '가림 처리한 글을 이 서비스로 보내요'}>
                <span className={`badge ${s.upstream.mock ? 'b-muted' : 'b-clean'}`}>{s.upstream.mock ? '개발용(mock)' : s.upstream.provider}</span>
              </Row>
              <Row title="콘솔을 열 수 있는 주소" sub="브라우저가 이 서버를 부를 수 있는 곳 (GATEWAY_CORS_ORIGINS)">
                <span className="mono" style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {s.protection.cors_origins.length ? s.protection.cors_origins.map((o) => <span key={o}>{o}</span>) : '—'}
                </span>
              </Row>
            </section>

            <section id="keep" className="card set-sec">
              <h2 className="ct">보관 · 유효 시간</h2>
              <p className="sub">글을 어디에 얼마나 두는지예요.</p>
              <Row title="입력한 글" sub="기록에는 어떤 종류가 몇 개 있었는지만 남고, 글 자체는 저장하지 않아요">
                <Status on={!s.retention.stores_prompt_text} yes="저장 안 함" no="저장함" warn />
              </Row>
              <Row title="되돌리기 매핑 보관" sub="[사람_1] ↔ 원래 값. 서버 메모리에만 있고 마지막 사용 뒤 이 시간이 지나면 사라져요">
                <span className="mono">{duration(s.retention.vault_ttl_seconds)}</span>
              </Row>
              <Row title="1회 허용 유효 시간" sub="승인했지만 쓰지 않으면 이 시간 뒤 저절로 끝나요">
                <span className="mono">{duration(s.retention.once_valid_seconds)}</span>
              </Row>
              <Row title="결정된 예외 요청 보관" sub="이보다 오래된 승인·반려 기록은 지워요">
                <span className="mono">{s.retention.decided_keep_days}일</span>
              </Row>
            </section>

            <section id="slack" className="card set-sec">
              <h2 className="ct">Slack 연동</h2>
              <p className="sub">직원이 새 예외 요청을 보내면 Slack 채널로 알려 드려요. 요청 번호·항목·사이트·기간·사유만 가고, 입력한 글은 가지 않아요.</p>
              <Row
                title="연결 상태"
                sub={s.slack.configured ? `보낼 곳: ${s.slack.host} (웹훅 주소는 보안상 보여 드리지 않아요)` : '서버 환경변수 SLACK_WEBHOOK_URL에 Slack의 Incoming Webhook 주소를 넣으면 연결돼요'}
              >
                <Status on={s.slack.configured} yes="연결됨" no="연결 안 됨" />
              </Row>
              <Row title="승인 화면 바로가기" sub={s.slack.console_link ? '알림에 예외 요청 화면 링크가 들어가요' : 'GATEWAY_CONSOLE_URL(콘솔 주소)을 넣으면 알림에 링크가 들어가요'}>
                <Status on={s.slack.console_link} yes="포함" no="없음" />
              </Row>
              <Row title="테스트 메시지" sub="연결이 잘 됐는지 채널에 한 줄 보내 봐요">
                <button type="button" className="btn" disabled={!s.slack.configured || test.isPending} onClick={() => test.mutate()}>
                  {test.isPending ? '보내는 중…' : 'Slack으로 테스트 보내기'}
                </button>
              </Row>
            </section>

            <section id="console" className="card set-sec">
              <h2 className="ct">콘솔</h2>
              <Row title="자동 로그아웃" sub="이 시간 동안 아무것도 하지 않으면 로그인 화면으로 돌아가요">
                <span className="mono">{local.data?.idleMinutes ?? 30}분</span>
              </Row>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
