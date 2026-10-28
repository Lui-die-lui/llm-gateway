// /demo · 사내 앱 시연. A stand-in for "an internal app that calls an LLM": it sends a sentence through the gateway exactly like
// any app would (POST /v1/chat/completions, industries in X-Gateway-Industry) and shows, side by side, what the employee typed,
// what the outside model received (POST /v1/analyze dry-run of the same sentence) and what the employee got back (restored).
// No login: it holds no admin data. The model behind the gateway is whatever the server is configured with (mock by default).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GATEWAY_URL, errorMessage } from '../../api/client';
import { gateway } from '../../api/gateway';
import type { AnalyzeResult } from '../../api/types';
import { industryName } from '../../features/catalog';
import { qk } from '../../features/queries';
import './demo.css';

const SAMPLES: { text: string; industries: string[] }[] = [
  { text: '고객 홍길동에게 보낼 배송 지연 사과 메일 초안을 써줘. 연락처는 kim@corp.co.kr', industries: [] },
  { text: '정제수 72.4%, 글리세린 5% 배합표를 영문으로 번역해줘', industries: ['cosmetics'] },
  { text: '선하증권번호: KOSL20240315A001 컨테이너 MSKU1234567 상태를 요약해줘', industries: ['logistics'] },
  { text: '환자번호 20240115 내원 기록을 요약해줘', industries: ['medical'] },
  { text: 'API 키 sk-abcdefghijklmnopqrstuvwxyz123456 이게 맞는지 봐줘', industries: [] },
];

interface Exchange {
  id: number;
  text: string;
  industries: string[];
  sent: AnalyzeResult | null; // what the outside model receives
  outcome: 'ok' | 'blocked' | 'error';
  reply?: string;
  redacted?: string | null;
  route?: string | null;
  findings?: Record<string, number>;
  message?: string;
}

const PLACEHOLDER = /(\[[^[\]\s]+_\d+\])/;

/** The text with every [유형_n] placeholder highlighted. */
function Marked({ text }: { text: string }) {
  // split() with one capture group puts the matches at the odd positions
  return (
    <>
      {text.split(PLACEHOLDER).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

const shownBase = GATEWAY_URL.startsWith('http') ? GATEWAY_URL : import.meta.env.DEV ? 'http://localhost:8000' : window.location.origin + GATEWAY_URL;

export function DemoPage() {
  const industries = useQuery({ queryKey: qk.industries, queryFn: gateway.industries, staleTime: 5 * 60_000 });
  const config = useQuery({ queryKey: qk.config, queryFn: gateway.config });
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Exchange[]>([]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const ex: Exchange = { id: Date.now(), text: body, industries: picked, sent: null, outcome: 'ok' };
    try {
      ex.sent = await gateway.analyze({ text: body, industries: picked });
      const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(picked.length ? { 'X-Gateway-Industry': picked.join(',') } : {}) },
        body: JSON.stringify({ model: 'demo', messages: [{ role: 'user', content: body }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        ex.reply = data.choices?.[0]?.message?.content ?? '';
        ex.redacted = res.headers.get('X-Gateway-Redacted');
        ex.route = res.headers.get('X-Gateway-Route');
      } else if (res.status === 403) {
        ex.outcome = 'blocked';
        ex.findings = data.error?.findings;
      } else {
        ex.outcome = 'error';
        ex.message = data.error?.message ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      ex.outcome = 'error';
      ex.message = errorMessage(e);
    }
    setLog((l) => [ex, ...l]);
    setText('');
    setBusy(false);
  }

  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));

  return (
    <main className="demo">
      <header className="demo-head">
        <div>
          <div className="crumb">사내 앱 시연</div>
          <h1>사내 앱이 LLM을 부르면</h1>
          <p className="t2">
            사내 앱이 게이트웨이 주소만 바꿔서 LLM을 부를 때 일어나는 일을 보여 줘요. 직원이 쓴 글, 바깥 모델이 실제로 받은 글, 직원이 돌려받은 답을
            나란히 봅니다.
          </p>
        </div>
        <Link to="/console" className="btn btn-sm">
          관리자 콘솔 →
        </Link>
      </header>

      {config.data?.mock && (
        <div className="demo-note" role="note">
          지금 연결된 모델은 <b>가짜(mock)</b>예요. 가린 글을 그대로 되돌려 주기 때문에 "답"이 보낸 글과 같아 보여요. 실제 모델을 연결하면 진짜 답이 와요.
          가리고 되돌리는 과정은 같아요.
        </div>
      )}

      <section className="card demo-form" aria-label="보내기">
        <div className="lbl">쓸 업종 (사내 앱이 헤더로 알려 줘요)</div>
        <div className="demo-chips" role="group" aria-label="업종">
          {(industries.data ?? []).map((i) => (
            <button key={i.industry} type="button" className="chip" aria-pressed={picked.includes(i.industry)} onClick={() => toggle(i.industry)}>
              {industryName(i.industry)}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="demo-text">
          LLM에게 시킬 일
        </label>
        <textarea
          id="demo-text"
          className="ta"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="LLM에게 시킬 일을 적어 보세요 (가짜 값만 쓰세요)"
        />
        <div className="demo-actions">
          <div className="demo-samples" role="group" aria-label="예시 문장">
            {SAMPLES.map((s) => (
              <button
                key={s.text}
                type="button"
                className="chip"
                onClick={() => {
                  setText(s.text);
                  setPicked(s.industries);
                }}
              >
                {s.text.slice(0, 16)}…
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-p" disabled={!text.trim() || busy} onClick={send}>
            {busy ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </section>

      {log.length === 0 && <div className="empty">아직 보낸 글이 없어요. 위 예시를 눌러 보세요.</div>}

      {log.map((ex) => (
        <article key={ex.id} className="card demo-ex" aria-label="주고받은 내용">
          <div className="demo-col">
            <div className="lbl">① 직원이 쓴 글</div>
            <p>{ex.text}</p>
            {ex.industries.length > 0 && <div className="t3">업종: {ex.industries.map(industryName).join(', ')}</div>}
          </div>
          <div className="demo-col">
            <div className="lbl">
              ② 바깥 모델이 받은 글{' '}
              {ex.outcome === 'blocked' ? (
                <span className="badge b-block">전송 안 됨</span>
              ) : ex.route ? (
                <span className="badge b-redact">{ex.route === 'internal' ? '내부 모델' : `가린 항목 ${ex.redacted ?? 0}개`}</span>
              ) : null}
            </div>
            {ex.outcome !== 'blocked' && ex.sent && (
              <p>
                <Marked text={ex.sent.sanitized} />
              </p>
            )}
            {ex.outcome === 'blocked' && (
              <p className="demo-warn">차단됐어요: {Object.keys(ex.findings ?? {}).join(', ') || '보내면 안 되는 정보'}가 들어 있어서 아무것도 나가지 않았어요.</p>
            )}
          </div>
          <div className="demo-col">
            <div className="lbl">③ 직원이 받은 답 (원래 값으로 복원)</div>
            {ex.outcome === 'ok' && <p>{ex.reply}</p>}
            {ex.outcome === 'blocked' && <p className="t3">받은 답이 없어요.</p>}
            {ex.outcome === 'error' && <p className="demo-warn">{ex.message}</p>}
          </div>
        </article>
      ))}

      <section className="card demo-code" aria-label="사내 앱 코드">
        <div className="lbl">사내 앱 쪽에서 바꾸는 것</div>
        <pre className="mono">{`client = OpenAI(base_url="${shownBase}/v1", api_key="...")   # 이 한 줄만 바뀝니다
client.chat.completions.create(
    model="...",
    messages=[{"role": "user", "content": "..."}],
    extra_headers={"X-Gateway-Industry": "cosmetics"},   # 쓸 업종(선택)
)`}</pre>
      </section>
    </main>
  );
}
