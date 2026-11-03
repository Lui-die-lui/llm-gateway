// Settings. What can be changed here is what the gateway really follows while it runs (PATCH /v1/settings and friends): the answer
// check, how long things are kept, the Slack webhook, access keys. Nothing here is a made-up switch. The facts the server was
// started with (admin token, AI connection, allowed origins) are shown at the bottom as they are, because they are environment variables.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { gateway } from '../../api/gateway';
import { errorMessage } from '../../api/client';
import type { NumericSetting, ServerSettings, SettingsValues } from '../../api/consoleTypes';
import { Toggle } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { IDLE_CHOICES, getIdleMinutes, setIdleMinutes } from '../../features/consolePrefs';
import { qk, useServerSettings } from '../../features/queries';
import './settings.css';

function Row({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="row-line">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{title}</div>
        {sub && (
          <div className="t3" style={{ fontSize: 13, marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto', display: 'flex', gap: 8, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

const TABS = [
  ['general', '일반'],
  ['alerts', '알림'],
  ['keys', '접속 키'],
  ['data', '데이터 · 기록'],
  ['env', '서버 환경'],
] as const;
type TabId = (typeof TABS)[number][0];
// Which tab a section lives in.
const TAB_OF: Record<string, TabId> = { check: 'general', keep: 'general', console: 'general', slack: 'alerts', keys: 'keys', data: 'data', log: 'data', env: 'env' };
const tabFromHash = (): TabId => {
  const h = window.location.hash.replace('#', '');
  return TABS.some(([id]) => id === h) ? (h as TabId) : 'general';
};

const NUMERIC: { key: NumericSetting; title: string; sub: string; unit: string }[] = [
  { key: 'vault_ttl_minutes', title: '되돌리기 매핑 보관', sub: '[사람_1] ↔ 원래 값. 서버 메모리에만 있고, 마지막으로 쓴 뒤 이 시간이 지나면 사라져요', unit: '분' },
  { key: 'once_valid_hours', title: '1회 허용 유효 시간', sub: '승인했지만 쓰지 않으면 이 시간 뒤 저절로 끝나요', unit: '시간' },
  { key: 'keep_decided_days', title: '결정된 예외 요청 보관', sub: '이보다 오래된 승인·반려 기록은 지워요', unit: '일' },
];

const when = (t: number) => new Date(t * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function SettingsPage() {
  const q = useServerSettings();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const s = q.data;

  // What is being edited (applied only when saved) and what the server has now.
  const [draft, setDraft] = useState<SettingsValues | null>(null);
  useEffect(() => {
    if (s) setDraft(s.values);
  }, [s]);
  const dirty = useMemo(() => !!s && !!draft && (Object.keys(s.values) as (keyof SettingsValues)[]).some((k) => s.values[k] !== draft[k]), [s, draft]);
  const problems = useMemo(() => {
    const p: Partial<Record<NumericSetting, string>> = {};
    if (s && draft)
      for (const n of NUMERIC) {
        const { min, max } = s.limits[n.key];
        const v = draft[n.key];
        if (!Number.isInteger(v) || v < min || v > max) p[n.key] = `${min}~${max}${n.unit} 사이로 적어 주세요`;
      }
    return p;
  }, [s, draft]);

  const unsaved: Partial<Record<TabId, boolean>> = useMemo(() => {
    if (!s || !draft) return {};
    const changed = (k: keyof SettingsValues) => s.values[k] !== draft[k];
    return { general: (['response_scan', 'vault_ttl_minutes', 'once_valid_hours', 'keep_decided_days'] as const).some(changed), alerts: changed('notify_new_exception') };
  }, [s, draft]);
  const refresh = (next: ServerSettings) => qc.setQueryData(qk.serverSettings, next);
  const fail = (e: unknown) => toast(errorMessage(e), 'error');

  const save = useMutation({ mutationFn: (patch: Partial<SettingsValues>) => consoleApi.saveSettings(patch), onSuccess: (r) => (refresh(r), toast('설정을 저장했어요 · 바로 적용돼요')), onError: fail });
  const slack = useMutation({ mutationFn: (url: string) => consoleApi.setSlack(url), onSuccess: (r) => (refresh(r), toast(r.slack.source === 'console' ? '웹훅 주소를 저장했어요' : '저장한 웹훅 주소를 지웠어요')), onError: fail });
  const slackTest = useMutation({ mutationFn: consoleApi.slackTest, onSuccess: (r) => toast(r.message, r.ok ? 'ok' : 'error'), onError: fail });
  const makeKey = useMutation({ mutationFn: (name: string) => consoleApi.createKey(name), onError: fail });
  const revoke = useMutation({ mutationFn: (id: number) => consoleApi.revokeKey(id), onSuccess: () => (qc.invalidateQueries({ queryKey: qk.serverSettings }), toast('키를 폐기했어요')), onError: fail });
  const wipe = useMutation({
    mutationFn: (which: 'audit' | 'exceptions') => (which === 'audit' ? gateway.clearAudit() : gateway.clearExceptions()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['gw'] });
      toast(`${r.deleted}건을 지웠어요`);
    },
    onError: fail,
  });

  const [hook, setHook] = useState('');
  const [keyName, setKeyName] = useState('');
  const [shown, setShown] = useState<{ key: string; name: string } | null>(null);
  const [idle, setIdle] = useState(getIdleMinutes);
  const [tab, setTabState] = useState<TabId>(tabFromHash);
  const setTab = (t: TabId) => {
    setTabState(t);
    window.history.replaceState(null, '', `#${t}`); // a reload or a shared link comes back to the same tab
  };
  const show = (section: string) => TAB_OF[section] === tab;

  async function onSave() {
    if (!s || !draft || !dirty) return;
    const patch: Partial<SettingsValues> = {};
    for (const k of Object.keys(draft) as (keyof SettingsValues)[]) if (draft[k] !== s.values[k]) (patch as Record<string, unknown>)[k] = draft[k];
    const turnsOff = patch.response_scan === false;
    const ok = await confirm({
      title: '설정 변경 저장',
      body: turnsOff ? '답변 검사를 끄면 AI가 돌려준 답에 민감 정보가 있어도 걸러 내지 못해요. 바뀐 내용은 바로 적용되고 "데이터 · 기록" 탭의 최근 변경에 남아요.' : '바뀐 내용은 바로 적용되고 "데이터 · 기록" 탭의 최근 변경에 남아요.',
      ok: '저장',
      danger: turnsOff,
    });
    if (ok) save.mutate(patch);
  }

  async function onCreateKey() {
    if (!s) return;
    const name = keyName.trim();
    if (!name) return toast('키 이름을 적어 주세요', 'error');
    if (!s.keys.required) {
      const ok = await confirm({
        title: '첫 접속 키 만들기',
        body: '지금은 키가 없어도 누구나 쓸 수 있어요. 키를 만들면 그 순간부터 키 없는 요청(키를 넣지 않은 확장 포함)이 막혀요. 만든 키를 확장 팝업의 연결 설정에 먼저 넣을 수 있게 준비하고 진행하세요.',
        ok: '만들기',
        danger: true,
      });
      if (!ok) return;
    }
    makeKey.mutate(name, {
      onSuccess: (r) => {
        setShown({ key: r.key, name: r.item.name });
        setKeyName('');
        qc.invalidateQueries({ queryKey: qk.serverSettings });
      },
    });
  }

  async function onRevoke(id: number, name: string, last: boolean) {
    const ok = await confirm({
      title: `'${name}' 키 폐기`,
      body: last && !s?.keys.env_keys ? '마지막 키를 폐기하면 접속 키 확인이 없어져 누구나 쓸 수 있게 돼요. 폐기한 키는 되살릴 수 없어요.' : '이 키를 쓰던 앱·확장은 바로 거절돼요. 폐기한 키는 되살릴 수 없어요.',
      ok: '폐기',
      danger: true,
    });
    if (ok) revoke.mutate(id);
  }

  async function onWipe(which: 'audit' | 'exceptions') {
    if (!s) return;
    const n = which === 'audit' ? s.data.audit_events : s.data.exception_requests;
    const ok = await confirm({
      title: which === 'audit' ? '전송 기록 모두 지우기' : '예외 요청 모두 지우기',
      body: `${n}건이 지워지고 되돌릴 수 없어요.${which === 'exceptions' ? ' 승인돼 있던 예외도 함께 사라져요.' : ''}`,
      ok: '모두 지우기',
      danger: true,
    });
    if (ok) wipe.mutate(which);
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('복사했어요');
    } catch {
      toast('복사하지 못했어요 · 직접 선택해서 복사해 주세요', 'error');
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">시스템 / 설정</div>
          <h1>설정</h1>
          <p className="t2">바꾼 내용은 서버가 바로 따라요 · 모든 변경은 "데이터 · 기록" 탭의 최근 변경에 남아요</p>
        </div>
        {s && draft && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {dirty && (
              <button type="button" className="btn" onClick={() => setDraft(s.values)}>
                되돌리기
              </button>
            )}
            <button type="button" className="btn btn-p" disabled={!dirty || save.isPending || Object.keys(problems).length > 0} onClick={onSave}>
              {dirty ? '변경 저장' : '바뀐 것 없음'}
            </button>
          </div>
        )}
      </header>

      {!s || !draft ? (
        <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
          <div className="set-tabs" role="tablist" aria-label="설정 구분">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls="set-panel" className={`set-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
                {label}
                {unsaved[id] ? <span className="set-dot" aria-label="저장 안 된 변경" /> : null}
              </button>
            ))}
          </div>
          <div id="set-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {show('check') && (
            <section id="check" className="card set-sec">
              <h2 className="ct">검사</h2>
              <Row title="답변 검사" sub="AI가 돌려준 답에서도 민감 정보를 찾아 가려요 · 끄면 답은 걸러지지 않아요">
                <Toggle on={draft.response_scan} label="답변 검사" onChange={(v) => setDraft({ ...draft, response_scan: v })} />
              </Row>
            </section>
            )}

            {show('keep') && (
            <section id="keep" className="card set-sec">
              <h2 className="ct">보관 · 유효 시간</h2>
              <p className="sub">입력한 글은 저장하지 않아요. 아래는 되돌리기와 예외 요청에 쓰는 시간이에요.</p>
              {NUMERIC.map((n) => (
                <Row key={n.key} title={n.title} sub={problems[n.key] ?? n.sub}>
                  <input
                    className="in mono"
                    type="number"
                    inputMode="numeric"
                    aria-label={n.title}
                    aria-invalid={!!problems[n.key]}
                    min={s.limits[n.key].min}
                    max={s.limits[n.key].max}
                    value={Number.isNaN(draft[n.key]) ? '' : draft[n.key]}
                    onChange={(e) => setDraft({ ...draft, [n.key]: e.target.value === '' ? NaN : Number(e.target.value) })}
                    style={{ width: 90, textAlign: 'right' }}
                  />
                  <span className="t2">{n.unit}</span>
                </Row>
              ))}
            </section>
            )}

            {show('slack') && (
            <section id="slack" className="card set-sec">
              <h2 className="ct">Slack 알림</h2>
              <p className="sub">직원이 새 예외 요청을 보내면 Slack 채널로 알려 드려요. 요청 번호·항목·사이트·기간·사유만 가고, 입력한 글은 가지 않아요.</p>
              <Row
                title="연결 상태"
                sub={s.slack.configured ? `보낼 곳: ${s.slack.host} · ${s.slack.source === 'console' ? '여기서 저장한 주소' : '서버 환경변수의 주소'} (주소 자체는 보안상 보여 드리지 않아요)` : 'Slack의 Incoming Webhook 주소를 넣으면 연결돼요'}
              >
                <span className={`badge ${s.slack.configured ? 'b-clean' : 'b-muted'}`}>{s.slack.configured ? '연결됨' : '연결 안 됨'}</span>
              </Row>
              <Row title="웹훅 주소" sub={s.slack.source === 'env' ? '여기서 저장하면 환경변수 값 대신 이 주소를 써요' : 'https://hooks.slack.com/services/… · 서버에만 저장되고 다시 보여 주지 않아요'}>
                <input className="in mono" type="password" autoComplete="off" aria-label="Slack 웹훅 주소" placeholder="https://hooks.slack.com/…" value={hook} onChange={(e) => setHook(e.target.value)} style={{ width: 240 }} />
                <button type="button" className="btn btn-p" disabled={!hook.trim() || slack.isPending} onClick={() => slack.mutate(hook, { onSuccess: () => setHook('') })}>
                  저장
                </button>
                {s.slack.source === 'console' && (
                  <button type="button" className="btn" disabled={slack.isPending} onClick={() => slack.mutate('')}>
                    지우기
                  </button>
                )}
              </Row>
              <Row title="새 예외 요청 알림" sub="끄면 주소는 그대로 두고 알림만 멈춰요 · 위쪽 '변경 저장'으로 적용돼요">
                <Toggle on={draft.notify_new_exception} label="새 예외 요청 알림" onChange={(v) => setDraft({ ...draft, notify_new_exception: v })} />
              </Row>
              <Row title="테스트 메시지" sub={s.slack.console_link ? '알림에 예외 요청 화면 링크가 함께 들어가요' : '연결이 잘 됐는지 채널에 한 줄 보내 봐요'}>
                <button type="button" className="btn" disabled={!s.slack.configured || slackTest.isPending} onClick={() => slackTest.mutate()}>
                  {slackTest.isPending ? '보내는 중…' : 'Slack으로 테스트 보내기'}
                </button>
              </Row>
            </section>
            )}

            {show('keys') && (
            <section id="keys" className="card set-sec">
              <h2 className="ct">접속 키</h2>
              <p className="sub">앱이나 확장이 이 서버를 쓰려면 키가 있어야 해요. 키는 만들 때 한 번만 보여 드리고, 서버에는 확인용 값만 남아요.</p>
              {!s.keys.required && (
                <div className="err-box" role="status" style={{ margin: '12px 0 0' }}>
                  지금은 키가 없어서 누구나 이 서버를 쓸 수 있어요. 첫 키를 만들면 그때부터 키 없는 요청이 막혀요.
                </div>
              )}
              {s.keys.env_keys > 0 && <p className="t3" style={{ fontSize: 13, margin: '10px 0 0' }}>서버 환경변수로 등록된 키 {s.keys.env_keys}개는 여기서 지울 수 없어요 (서버 설정에서 바꿔요).</p>}
              {s.keys.list.map((k) => (
                <Row key={k.id} title={k.name} sub={`…${k.tail} · ${when(k.created)}에 만듦`}>
                  {k.revoked ? (
                    <span className="badge b-muted">폐기됨</span>
                  ) : (
                    <button type="button" className="btn btn-d btn-sm" disabled={revoke.isPending} onClick={() => onRevoke(k.id, k.name, s.keys.list.filter((x) => !x.revoked).length === 1)}>
                      폐기
                    </button>
                  )}
                </Row>
              ))}
              <Row title="새 키 만들기" sub="키를 쓸 앱 이름을 적어요 (예: 인사팀 앱, 확장)">
                <input className="in" aria-label="키 이름" placeholder="키 이름" value={keyName} maxLength={40} onChange={(e) => setKeyName(e.target.value)} style={{ width: 180 }} />
                <button type="button" className="btn btn-p" disabled={makeKey.isPending} onClick={onCreateKey}>
                  키 만들기
                </button>
              </Row>
              {shown && (
                <div className="card" role="status" aria-label="새로 만든 키" style={{ marginTop: 12, border: '1px solid var(--accent)' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>'{shown.name}' 키가 만들어졌어요</div>
                  <p className="t2" style={{ fontSize: 13, margin: '4px 0 10px' }}>지금 복사해 두세요. 이 창을 닫으면 다시 볼 수 없어요.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="in mono" readOnly aria-label="새 키" value={shown.key} onFocus={(e) => e.currentTarget.select()} style={{ flex: '1 1 280px' }} />
                    <button type="button" className="btn btn-p" onClick={() => copy(shown.key)}>
                      복사
                    </button>
                    <button type="button" className="btn" onClick={() => setShown(null)}>
                      닫기
                    </button>
                  </div>
                </div>
              )}
            </section>
            )}

            {show('data') && (
            <section id="data" className="card set-sec">
              <h2 className="ct">데이터 비우기</h2>
              <p className="sub">발표나 시연 전에 쌓인 데이터를 정리할 때 써요. 지운 데이터는 되돌릴 수 없어요.</p>
              <Row title="전송 기록" sub={`지금 ${s.data.audit_events.toLocaleString('ko-KR')}건 · 개요·기록·리포트의 숫자가 0부터 다시 시작해요`}>
                <button type="button" className="btn btn-d" disabled={s.data.audit_events === 0 || wipe.isPending} onClick={() => onWipe('audit')}>
                  모두 지우기
                </button>
              </Row>
              <Row title="예외 요청" sub={`지금 ${s.data.exception_requests.toLocaleString('ko-KR')}건 · 승인돼 있던 예외도 함께 사라져요`}>
                <button type="button" className="btn btn-d" disabled={s.data.exception_requests === 0 || wipe.isPending} onClick={() => onWipe('exceptions')}>
                  모두 지우기
                </button>
              </Row>
            </section>
            )}

            {show('console') && (
            <section id="console" className="card set-sec">
              <h2 className="ct">콘솔</h2>
              <Row title="자동 로그아웃" sub="이 브라우저에서 아무것도 하지 않으면 로그인 화면으로 돌아가요 · 바로 적용돼요">
                <select
                  className="sel"
                  aria-label="자동 로그아웃"
                  value={idle}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setIdle(v);
                    setIdleMinutes(v);
                    toast(`${v}분 동안 쓰지 않으면 로그아웃돼요`);
                  }}
                  style={{ width: 110 }}
                >
                  {IDLE_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {m}분
                    </option>
                  ))}
                </select>
              </Row>
            </section>
            )}

            {show('log') && (
            <section id="log" className="card set-sec">
              <h2 className="ct">최근 변경</h2>
              {s.log.length === 0 ? (
                <div className="empty">아직 바꾼 내용이 없어요</div>
              ) : (
                s.log.map((e, i) => (
                  <Row key={`${e.t}-${i}`} title={e.what} sub={e.detail}>
                    <span className="t3 mono" style={{ fontSize: 12.5 }}>
                      {when(e.t)}
                    </span>
                  </Row>
                ))
              )}
            </section>
            )}

            {show('env') && (
            <section id="env" className="card set-sec">
              <h2 className="ct">서버 환경</h2>
              <p className="sub">서버를 켤 때 환경변수로 정한 값이라 여기서는 바꿀 수 없어요 (docs/DEPLOY.md).</p>
              <Row title="관리자 토큰" sub={s.environment.admin_protected ? '통계·기록·정책은 토큰이 있어야 볼 수 있어요' : '지금은 누구나 이 화면과 통계를 볼 수 있어요 · 배포 서버에는 GATEWAY_ADMIN_TOKEN을 설정하세요'}>
                <span className={`badge ${s.environment.admin_protected ? 'b-clean' : 'b-block'}`}>{s.environment.admin_protected ? '보호됨' : '열려 있음'}</span>
              </Row>
              <Row title="AI 연결" sub={s.environment.mock ? '실제 AI 대신 가짜 답을 돌려주는 개발용 모드예요' : '가림 처리한 글을 이 서비스로 보내요'}>
                <span className={`badge ${s.environment.mock ? 'b-muted' : 'b-clean'}`}>{s.environment.mock ? '개발용(mock)' : s.environment.provider}</span>
              </Row>
              <Row title="한 번에 검사하는 글자 수" sub="이보다 길면 거절해요 (GATEWAY_MAX_TEXT)">
                <span className="mono">{s.environment.max_text.toLocaleString('ko-KR')}자</span>
              </Row>
              <Row title="입력한 글" sub="기록에는 어떤 종류가 몇 개 있었는지만 남고, 글 자체는 저장하지 않아요">
                <span className={`badge ${s.environment.stores_prompt_text ? 'b-block' : 'b-clean'}`}>{s.environment.stores_prompt_text ? '저장함' : '저장 안 함'}</span>
              </Row>
              <Row title="콘솔을 열 수 있는 주소" sub="브라우저가 이 서버를 부를 수 있는 곳 (GATEWAY_CORS_ORIGINS)">
                <span className="mono" style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {s.environment.cors_origins.length ? s.environment.cors_origins.map((o) => <span key={o}>{o}</span>) : '—'}
                </span>
              </Row>
            </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}
