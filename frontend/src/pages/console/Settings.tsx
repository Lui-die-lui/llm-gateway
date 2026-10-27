// 08 설정 (Settings.dc.html). Mock store (localStorage). "관리자 2단계 인증" changes the login flow and
// "콘솔 자동 로그아웃" changes the idle timeout of this console.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import type { Settings } from '../../api/consoleTypes';
import { MockBadge, Toggle } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { INDUSTRY_KO, useIndustries } from '../../features/catalog';
import { useFeedback } from '../../features/feedback';
import { qk, useCompany, useSettings } from '../../features/queries';
import './settings.css';

function Row({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="row-line">
      <div>
        <div style={{ fontSize: 13.5 }}>{title}</div>
        {sub && (
          <div className="t3" style={{ fontSize: 12, marginTop: 2 }}>
            {sub}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

const SECTIONS = [
  ['org', '회사 정보'],
  ['auth', '가입 · 로그인'],
  ['sites', '보호할 사이트'],
  ['notify', 'Slack 연동'],
  ['privacy', '기록 보관'],
  ['danger', '위험 구역'],
] as const;

export function SettingsPage() {
  const qc = useQueryClient();
  const loc = useLocation();
  const { toast, confirm } = useFeedback();
  const saved = useSettings();
  const company = useCompany();
  const industries = useIndustries();
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => {
    if (saved.data) setDraft(saved.data);
  }, [saved.data]);

  // Deep links such as /console/settings#notify (from 분석 리포트).
  useEffect(() => {
    if (!loc.hash || !draft) return;
    document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loc.hash, draft]);

  const save = useMutation({
    mutationFn: (s: Settings) => consoleApi.saveSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      qc.invalidateQueries({ queryKey: qk.company });
      qc.invalidateQueries({ queryKey: qk.adminLog });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!draft) return <QueryState isLoading={saved.isLoading} error={saved.error} />;

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.data);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...draft, [k]: v });
  const flip = (k: 'mailOnly' | 'lockout' | 'twoFactor', label: string) => (v: boolean) => {
    set(k, v);
    toast(`${label} · ${v ? '켜짐' : '꺼짐'} · 저장해야 적용돼요`);
  };
  const site = (k: keyof Settings['sites'], label: string) => (v: boolean) => {
    set('sites', { ...draft.sites, [k]: v });
    toast(`${label} · ${v ? '켜짐' : '꺼짐'} · 저장해야 적용돼요`);
  };
  const industryIds = industries.data?.map((i) => i.industry) ?? Object.keys(INDUSTRY_KO);

  async function onSave() {
    if (!dirty) return toast('바뀐 설정이 없어요');
    if (await confirm({ title: '설정 변경 저장', body: '변경 사항이 바로 적용되고 관리자 작업 기록에 남습니다.', ok: '저장' })) {
      save.mutate(draft!, { onSuccess: () => toast('설정을 저장했습니다') });
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">회사 / 설정</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <h1 style={{ margin: 0 }}>설정</h1>
            <MockBadge />
          </div>
          <p className="t2">꼭 필요한 것만 남겼어요 · 바꾼 내용은 기록 › 관리자 작업에 남아요</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {dirty && (
            <button type="button" className="btn" onClick={() => setDraft(saved.data!)}>
              되돌리기
            </button>
          )}
          <button type="button" className="btn btn-p" disabled={save.isPending} onClick={onSave}>
            변경 저장
          </button>
        </div>
      </header>

      <div className="row-wrap top">
        <nav className="snav card" aria-label="설정 섹션">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} style={id === 'danger' ? { color: 'var(--danger)' } : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div style={{ flex: '4 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section id="org" className="card set-sec">
            <h2 className="ct">회사 정보</h2>
            <p className="sub">회사를 등록할 때 넣은 정보예요.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14, marginTop: 16 }}>
              <label className="field">
                <span>회사 이름</span>
                <input className="in" value={draft.companyName} onChange={(e) => set('companyName', e.target.value)} />
              </label>
              <label className="field">
                <span>업종 (기본 규칙 묶음)</span>
                <select className="sel" value={draft.industry} onChange={(e) => set('industry', e.target.value)}>
                  {industryIds.map((id) => (
                    <option key={id} value={id}>
                      {INDUSTRY_KO[id] ?? id}
                    </option>
                  ))}
                  <option value="">그 밖의 업종 (공통만)</option>
                </select>
              </label>
              <label className="field">
                <span>회사 메일 주소</span>
                <input className="in mono" value={draft.mailDomain} onChange={(e) => set('mailDomain', e.target.value)} />
              </label>
              <label className="field">
                <span>회사 코드</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="in mono" value={company.data?.code ?? ''} readOnly aria-readonly="true" style={{ flex: 1 }} />
                  <Link className="btn btn-sm" to="/console/users">
                    관리
                  </Link>
                </span>
              </label>
            </div>
          </section>

          <section id="auth" className="card set-sec">
            <h2 className="ct">가입 · 로그인</h2>
            <div style={{ marginTop: 12 }}>
              <Row title="직원 가입은 관리자 승인 후 사용" sub="회사 코드로 신청 → 구성원 · 가입 승인에서 승인">
                <span className="badge b-muted">항상 켜짐</span>
              </Row>
              <Row title="회사 메일 주소로만 신청 받기" sub={`${draft.mailDomain} 이 아닌 메일은 신청 단계에서 막아요 · 끄면 승인 화면에 경고만 떠요`}>
                <Toggle on={draft.mailOnly} label="회사 메일로만 신청" onChange={flip('mailOnly', '회사 메일로만 신청')} />
              </Row>
              <Row title="로그인 실패 잠금" sub="5번 틀리면 15분 잠금 · 확장과 콘솔 모두">
                <Toggle on={draft.lockout} label="로그인 실패 잠금" onChange={flip('lockout', '로그인 실패 잠금')} />
              </Row>
              <Row title="관리자 2단계 인증 (선택)" sub="켜면 콘솔 로그인 때 인증 앱 6자리를 한 번 더 확인 · 기본 꺼짐">
                <Toggle on={draft.twoFactor} label="관리자 2단계 인증" onChange={flip('twoFactor', '관리자 2단계 인증')} />
              </Row>
              <Row title="콘솔 자동 로그아웃" sub="아무것도 안 하면">
                <select className="sel" style={{ width: 140 }} aria-label="자동 로그아웃" value={draft.idleMinutes} onChange={(e) => set('idleMinutes', Number(e.target.value) as Settings['idleMinutes'])}>
                  <option value={30}>30분</option>
                  <option value={60}>1시간</option>
                  <option value={480}>8시간</option>
                </select>
              </Row>
            </div>
          </section>

          <section id="sites" className="card set-sec">
            <h2 className="ct">보호할 사이트</h2>
            <p className="sub">여기 있는 사이트에서만 확장이 동작해요.</p>
            <div style={{ marginTop: 12 }}>
              <Row title="chatgpt.com" sub="ChatGPT">
                <Toggle on={draft.sites.chatgpt} label="chatgpt.com" onChange={site('chatgpt', 'chatgpt.com')} />
              </Row>
              <Row title="claude.ai" sub="Claude">
                <Toggle on={draft.sites.claude} label="claude.ai" onChange={site('claude', 'claude.ai')} />
              </Row>
              <Row title="gemini.google.com" sub="Gemini">
                <Toggle on={draft.sites.gemini} label="gemini.google.com" onChange={site('gemini', 'gemini.google.com')} />
              </Row>
            </div>
          </section>

          <section id="notify" className="card set-sec">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 className="ct">Slack 연동</h2>
              <span className={`badge ${draft.slackConnected ? 'b-clean' : 'b-muted'}`}>{draft.slackConnected ? `연결됨 · ${draft.slackWorkspace}` : '연결 안 됨'}</span>
            </div>
            <p className="sub">교육 대상 후보에게 Slack 개인 메시지를 보낼 때 써요. 회사 메일 주소로 Slack 사용자를 찾아요.</p>
            <div style={{ marginTop: 12 }}>
              <Row title="보내는 앱 이름" sub="직원에게 이 이름으로 보여요">
                <input className="in" aria-label="보내는 앱 이름" value={draft.slackAppName} onChange={(e) => set('slackAppName', e.target.value)} style={{ width: 200 }} />
              </Row>
              <Row title="메일로 찾지 못한 사람" sub={'Slack에 다른 메일로 가입한 경우 · 발송 목록에 "못 찾음"으로 표시'}>
                <span className="badge b-muted">{draft.slackUnmatched}명</span>
              </Row>
              <Row title={draft.slackConnected ? '연결 해제' : '다시 연결'} sub={draft.slackConnected ? '해제하면 교육 대상 후보의 "Slack 보내기" 버튼이 꺼져요' : '연결하면 교육 대상 후보에게 메시지를 보낼 수 있어요'}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    const next = !draft.slackConnected;
                    if (!next && !(await confirm({ title: 'Slack 연결 해제', body: '해제하면 교육 대상 후보에게 메시지를 보낼 수 없어요.', ok: '해제', danger: true }))) return;
                    const s = { ...saved.data!, slackConnected: next };
                    setDraft({ ...draft, slackConnected: next });
                    save.mutate(s, { onSuccess: () => toast(next ? 'Slack을 다시 연결했어요 (예시)' : 'Slack 연결을 해제했어요') });
                  }}
                >
                  {draft.slackConnected ? '해제' : '연결'}
                </button>
              </Row>
            </div>
          </section>

          <section id="privacy" className="card set-sec">
            <h2 className="ct">기록 보관</h2>
            <div style={{ marginTop: 12 }}>
              <Row title="프롬프트 원문 · 원래 값" sub="어디에도 저장하지 않아요">
                <span className="badge b-muted">저장 안 함</span>
              </Row>
              <Row title="전송 기록 보관 기간" sub="시각 · 사이트 · 탐지 종류 · 개수 · 처리 결과만">
                <select className="sel" style={{ width: 140 }} aria-label="보관 기간" value={draft.retentionDays} onChange={(e) => set('retentionDays', Number(e.target.value) as Settings['retentionDays'])}>
                  <option value={90}>90일</option>
                  <option value={30}>30일</option>
                  <option value={365}>1년</option>
                </select>
              </Row>
              <Row title="직원 기기의 치환 기록" sub="직원 본인만 보는 기록 · 원래 단어는 일부만 (홍*동)">
                <select className="sel" style={{ width: 140 }} aria-label="기기 기록" value={draft.deviceHistory} onChange={(e) => set('deviceHistory', e.target.value as Settings['deviceHistory'])}>
                  <option>7일</option>
                  <option>1일</option>
                  <option>남기지 않음</option>
                </select>
              </Row>
            </div>
          </section>

          <section id="danger" className="card set-sec" style={{ borderColor: 'rgba(220,38,38,.45)' }}>
            <h2 className="ct" style={{ color: 'var(--danger)' }}>
              위험 구역
            </h2>
            <p className="sub">실행하면 모든 보안 관리자에게 알림이 가고 관리자 작업 기록에 남아요.</p>
            <div style={{ marginTop: 12 }}>
              <Row title="보호 잠시 끄기" sub="최대 1시간 · 모든 전송이 검사 없이 나가요 · 시간이 지나면 자동으로 다시 켜져요">
                <button
                  type="button"
                  className="btn btn-sm btn-d"
                  onClick={async () => {
                    if (await confirm({ title: '보호 잠시 끄기', body: '최대 1시간 동안 모든 전송이 검사 없이 나갑니다. 모든 보안 관리자에게 알림이 갑니다.', ok: '끄기', danger: true })) {
                      await consoleApi.pauseProtection();
                      qc.invalidateQueries({ queryKey: qk.adminLog });
                      toast('보호를 1시간 동안 껐습니다 · 자동 복귀 예정');
                    }
                  }}
                >
                  잠시 끄기
                </button>
              </Row>
              <Row title="회사 삭제" sub="구성원 · 규칙 · 기록이 30일 뒤 모두 지워져요 · 소유자만 가능">
                <button
                  type="button"
                  className="btn btn-sm btn-d"
                  onClick={async () => {
                    if (await confirm({ title: '회사 삭제', body: '구성원, 규칙, 기록이 30일 뒤 모두 지워집니다. 30일 안에는 취소할 수 있어요.', ok: '삭제', danger: true })) {
                      await consoleApi.scheduleCompanyDelete();
                      qc.invalidateQueries({ queryKey: qk.adminLog });
                      toast('회사 삭제를 예약했습니다 · 30일 뒤 실행');
                    }
                  }}
                >
                  회사 삭제
                </button>
              </Row>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
