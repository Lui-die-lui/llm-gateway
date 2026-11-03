// 05 정책 엔진 (Policy.dc.html). Rules, drafts and applying them all go through /v1/policy.
// "미리 시험하기" calls the real POST /v1/analyze.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { gateway } from '../../api/gateway';
import type { PolicyRule, RuleAction, RuleDraft, RuleKind } from '../../api/consoleTypes';
import type { AnalyzeResult } from '../../api/types';
import { Help, Seg, Toggle } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { useBuiltinGroups, useIndustries } from '../../features/catalog';
import { useFeedback } from '../../features/feedback';
import { ACTION_KO, splitByCodepoints } from '../../features/format';
import { qk } from '../../features/queries';

const ACT_CLS: Record<RuleAction, string> = { redact: 'b-redact', block: 'b-block', log: 'b-clean' };
const KINDS = [
  ['builtin', '기본 정보'],
  ['words', '회사 단어 목록'],
  ['pattern', '모양 (패턴)'],
] as const;
// Rules of this kind were saved before the local LLM was dropped; nothing detects them any more, so it is only offered when one is open.
const OLD_AI = ['ai', '설명으로 (지원 종료)'] as const;
const ACTIONS = [
  ['redact', '가림'],
  ['block', '차단'],
  ['log', '기록만'],
] as const;
const KIND_HELP: Record<RuleKind, string> = {
  builtin: '자주 쓰는 정보는 미리 준비돼 있어요. 고르기만 하면 돼요.',
  words: '회사만 쓰는 이름(프로젝트명, 거래처명)을 목록으로 넣어요. 가장 정확하고 업종과 상관없이 쓸 수 있어요.',
  pattern: '숫자·글자 모양이 정해진 값을 찾아요.',
  ai: '목록으로 만들기 어려운 것을 말로 설명해요. 가장 넓게 찾지만 덜 정확해요.',
};
const ACTION_HELP: Record<RuleAction, string> = {
  redact: '찾은 값을 이름표로 바꿔 보내고, 답이 오면 화면에서 원래대로 보여 줘요.',
  block: '보내지 않아요. 직원은 그 부분만 지우거나 예외를 요청할 수 있어요.',
  log: '바꾸지 않고 보내되 몇 번 나왔는지만 기록해요. 새 규칙을 시험할 때 써요.',
};
const DEPTS = ['전사', '연구소', '영업', '개발', '정보보호팀'];
const BLANK: RuleDraft = {
  name: '',
  kind: 'words',
  action: 'redact',
  scope: ['전사'],
  enabled: true,
  builtins: [],
  words: '',
  pattern: '',
  ai: '',
  tag: '[이름표_n]',
  options: { ask: true, exc: false, notify: false },
};
const SAMPLE = '고객 홍길동 팀장님께 프로젝트 블루문 일정 공유 · 담당 kim@example.com · 연락처 010-0000-0000';

const draftOf = (r: PolicyRule): RuleDraft => ({
  name: r.name,
  kind: r.kind,
  action: r.action,
  scope: r.scope,
  enabled: r.enabled,
  builtins: r.builtins,
  words: r.words,
  pattern: r.pattern,
  ai: r.ai,
  tag: r.tag,
  options: r.options,
});

export function PolicyPage() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const policy = useQuery({ queryKey: qk.policy, queryFn: consoleApi.policy });
  const industries = useIndustries();
  const BUILTINS = useBuiltinGroups()?.flatMap((g) => g.rules.map((r) => r.name)) ?? [];

  const [mode, setMode] = useState<'edit' | 'new'>('edit');
  const [selId, setSelId] = useState('');
  const [draft, setDraft] = useState<RuleDraft>(BLANK);
  const rules = policy.data?.rules ?? [];
  const sel = rules.find((r) => r.id === selId);

  // First visit: select the first rule, or start a new one when the company has none yet.
  useEffect(() => {
    if (!policy.data || mode === 'new' || sel) return;
    const first = rules[0];
    if (first) setSelId(first.id);
    else setMode('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.data, mode, sel]);

  // Load the selected rule into the editor (or a blank one for "새 규칙").
  useEffect(() => {
    if (mode === 'new') return;
    if (sel) setDraft(draftOf(sel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, mode, policy.dataUpdatedAt]);

  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.policy });
    qc.invalidateQueries({ queryKey: qk.adminLog });
  };
  const fail = (e: unknown) => toast(errorMessage(e), 'error');

  const toggle = useMutation({ mutationFn: consoleApi.toggleRule, onSuccess: (_, id) => (refresh(), toast(`${rules.find((r) => r.id === id)?.name ?? '규칙'} · 변경으로 저장했어요 · 승인해야 적용돼요`)), onError: fail });
  const save = useMutation({ mutationFn: () => consoleApi.saveRule(selId, draft), onSuccess: () => (refresh(), toast('변경으로 저장했어요 · 승인해야 적용돼요')), onError: fail });
  const add = useMutation({
    mutationFn: () => consoleApi.addRule(draft),
    onSuccess: (r) => {
      refresh();
      setMode('edit');
      setSelId(r.id);
      toast(`"${draft.name.trim()}" 규칙을 목록 맨 아래에 추가했어요 · 승인 전까지 적용 안 됨`);
    },
    onError: fail,
  });
  const apply = useMutation({ mutationFn: consoleApi.applyPolicy, onSuccess: (r) => (refresh(), toast(`버전 ${r.version}를 적용했어요 · 직원 확장이 몇 분 안에 받아요`)), onError: fail });

  const pending = policy.data?.pending.length ?? 0;
  const isNew = mode === 'new';

  // ---- playground (real /v1/analyze)
  const [sample, setSample] = useState(SAMPLE);
  const [tplOn, setTplOn] = useState(true);
  const allIndustries = (industries.data ?? []).map((i) => i.industry); // no company setting exists: try every industry bundle
  const run = useMutation({ mutationFn: (text: string) => gateway.analyze({ text, use_draft: true, industries: tplOn ? allIndustries : [] }) });
  const result: AnalyzeResult | undefined = run.data;
  const pieces = useMemo(() => (result && run.variables ? splitByCodepoints(run.variables, result.spans) : []), [result, run.variables]);

  async function onApply() {
    if (!pending) return;
    const ok = await confirm({
      title: `변경 ${pending}건 적용`,
      body: `저장된 변경 ${pending}건을 승인하고 바로 적용합니다. 직원 확장은 몇 분 안에 새 규칙을 받아요. 언제든 이전 버전으로 되돌릴 수 있어요.`,
      ok: '승인하고 적용',
    });
    if (ok) apply.mutate();
  }

  const remove = useMutation({
    mutationFn: () => consoleApi.deleteRule(selId),
    onSuccess: () => (refresh(), setSelId(''), toast('삭제를 변경으로 저장했어요 · 승인해야 적용돼요')),
    onError: fail,
  });
  async function onDelete() {
    const ok = await confirm({ title: '규칙 삭제', body: `"${sel?.name}" 규칙을 삭제 변경으로 저장해요. 승인해야 실제로 빠져요.`, ok: '삭제로 저장', danger: true });
    if (ok) remove.mutate();
  }

  const chipToggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">정책 / 정책 엔진</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>정책 엔진</h1>
            <span className="badge b-clean">적용 중 · 버전 {policy.data?.version ?? '…'}</span>
            {pending > 0 && <span className="badge b-accent">저장 안 된 변경 {pending}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <a
            className="btn"
            href="#editor"
            onClick={() => {
              setMode('new');
              setDraft(BLANK);
            }}
          >
            + 새 규칙 만들기
          </a>
          <button type="button" className="btn btn-p" disabled={!pending || apply.isPending} onClick={onApply}>
            {pending ? `변경 ${pending}건 승인하고 적용` : '적용할 변경 없음'}
          </button>
          <Help label="적용 방법 도움말" title="적용 방법">
            <ol>
              <li>규칙을 고치고 "변경으로 저장" · 아직 적용 안 됨</li>
              <li>보안 관리자가 "승인하고 적용"을 누름</li>
              <li>직원 확장이 몇 분 안에 새 규칙을 받음</li>
              <li>문제가 있으면 그 규칙을 끄거나 고쳐서 다시 승인하고 적용해요</li>
            </ol>
          </Help>
        </div>
      </header>

      <section className="card" style={{ padding: '14px 8px 8px' }}>
        <div className="ch" style={{ padding: '0 10px' }}>
          <h2 className="ct">
            규칙 목록{' '}
            <span className="t3" style={{ fontWeight: 400, fontSize: 13.5 }}>
              · 위에서부터 확인 · 먼저 맞는 규칙 적용
            </span>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="chip">전체 {rules.length}</span>
            <span className="chip">활성 {rules.filter((r) => r.enabled).length}</span>
            <span className="chip">초안 {pending}</span>
          </div>
        </div>
        <QueryState isLoading={policy.isLoading} error={policy.error} />
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>규칙명</th>
                <th>무엇을 찾나</th>
                <th>처리</th>
                <th>대상</th>
                <th className="num">24시간 일치</th>
                <th>사용</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const draftNote = policy.data?.pending.find((p) => p.ruleId === r.id);
                return (
                  <tr key={r.id} className={mode === 'edit' && selId === r.id ? 'is-selected' : ''}>
                    <td className="mono t3">{r.prio}</td>
                    <td>
                      <a
                        href="#editor"
                        onClick={() => {
                          setMode('edit');
                          setSelId(r.id);
                        }}
                        style={{ textDecoration: 'none', color: 'var(--ink)', fontWeight: 500 }}
                      >
                        {r.name}
                      </a>
                      {(r.isNew || draftNote) && (
                        <span className="mono t3" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                          {r.isNew ? '새로 추가 · 승인 전' : '변경 · 승인 전'}
                        </span>
                      )}
                    </td>
                    <td className="t2" style={{ whiteSpace: 'normal', minWidth: 200 }}>
                      {r.cond}
                    </td>
                    <td>
                      <span className={`badge ${ACT_CLS[r.action]}`}>{ACTION_KO[r.action]}</span>
                    </td>
                    <td>
                      <span className="chip">{r.scope.join(', ')}</span>
                    </td>
                    <td className="mono num">{r.hits}</td>
                    <td>
                      <Toggle on={r.enabled} label={`${r.name} 사용`} onChange={() => toggle.mutate(r.id)} disabled={toggle.isPending} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="row-wrap top">
        <section id="editor" className="card" style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 18, scrollMarginTop: 16 }}>
          <div className="ch" style={{ margin: 0 }}>
            <div>
              <div className="lbl">{isNew ? '새 규칙 만들기' : '규칙 편집'}</div>
              <h2 className="ct" style={{ marginTop: 6, fontSize: 17 }}>
                {isNew ? draft.name || '이름 없는 새 규칙' : draft.name}
              </h2>
            </div>
            <Seg
              label="편집 방식"
              options={[
                ['edit', '기존 규칙 편집'],
                ['new', '새 규칙 만들기'],
              ]}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setDraft(m === 'new' ? BLANK : sel ? draftOf(sel) : BLANK);
              }}
            />
          </div>
          {!isNew ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: -8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setMode('new');
                  setDraft({ ...draft, name: `${draft.name} (복사본)` });
                  toast('복사본을 새 규칙으로 열었어요 · 이름을 바꿔 주세요');
                }}
              >
                복제해서 새로 만들기
              </button>
              <button type="button" className="btn btn-sm btn-d" onClick={onDelete}>
                삭제
              </button>
            </div>
          ) : (
            <div style={{ marginTop: -8, padding: '10px 12px', borderRadius: 12, background: 'rgba(37,99,235,.08)', fontSize: 13.5, color: '#1E3A8A' }}>
              새 규칙은 목록 맨 아래에 추가돼요. 위치를 옮기면 먼저 확인할 순서가 바뀌어요. "규칙 추가"를 눌러도 승인 전까지는 적용되지 않아요.
            </div>
          )}

          <label className="field">
            <span>규칙명</span>
            <input className="in" value={draft.name} placeholder="예: 거래처 이름, 신제품 코드명" onChange={(e) => set('name', e.target.value)} />
          </label>

          <div className="field">
            <span>1 · 무엇을 찾을까요</span>
            <Seg label="찾는 방법" options={draft.kind === 'ai' ? [...KINDS, OLD_AI] : KINDS} value={draft.kind} onChange={(v) => set('kind', v)} />
            <span className="t3" style={{ fontSize: 12.5 }}>
              {KIND_HELP[draft.kind]}
            </span>
            <div style={{ background: 'rgba(255,255,255,.72)', border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draft.kind === 'builtin' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="기본 정보 고르기">
                  {BUILTINS.map((b) => (
                    <button key={b} type="button" className="chip" aria-pressed={draft.builtins.includes(b)} onClick={() => set('builtins', chipToggle(draft.builtins, b))}>
                      {b}
                    </button>
                  ))}
                </div>
              )}
              {draft.kind === 'words' && (
                <>
                  <label className="sr-only" htmlFor="rule-words">
                    단어 목록
                  </label>
                  <textarea id="rule-words" className="ta" value={draft.words} onChange={(e) => set('words', e.target.value)} placeholder={'한 줄에 하나씩\n예: 프로젝트 블루문\n예: 코드명 HB-21'} />
                  <span className="t3" style={{ fontSize: 12.5 }}>
                    한 줄에 하나씩 · 회사 안에서만 쓰는 이름을 넣으세요 · 비슷한 띄어쓰기도 같이 찾아요
                  </span>
                </>
              )}
              {draft.kind === 'pattern' && (
                <>
                  <input className="in mono" aria-label="패턴" value={draft.pattern} onChange={(e) => set('pattern', e.target.value)} placeholder="예: (EMP|DOC)-\d{4}" />
                  <span className="t3" style={{ fontSize: 12.5 }}>
                    모양으로 찾기 · 예: 사번(EMP-0000), 문서번호, 단가처럼 숫자 모양이 정해진 값
                  </span>
                </>
              )}
              {draft.kind === 'ai' && (
                <>
                  <input className="in" aria-label="찾을 내용 설명" value={draft.ai} onChange={(e) => set('ai', e.target.value)} />
                  <span className="t3" style={{ fontSize: 12.5 }}>
                    설명으로 찾기 · 검사 서버의 모델이 문맥을 보고 판단해요 · 놓치거나 잘못 잡을 수 있어 "검토 창 띄우기"와 같이 쓰세요
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="field">
            <span>2 · 찾으면 어떻게 할까요</span>
            <Seg label="처리" options={ACTIONS} value={draft.action} onChange={(v) => setDraft((d) => ({ ...d, action: v, options: { ...d.options, ask: v !== 'block', exc: v === 'block' } }))} />
            <span className="t3" style={{ fontSize: 12.5 }}>
              {ACTION_HELP[draft.action]}
            </span>
            {draft.action === 'redact' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginTop: 4 }}>
                <label className="field">
                  <span>무엇으로 바꿀까요</span>
                  <select className="sel" style={{ height: 36 }}>
                    <option>자리표시자 · [이름표_1]</option>
                    <option>등록된 대체어</option>
                  </select>
                </label>
                <label className="field">
                  <span>이름표</span>
                  <input className="in mono" value={draft.tag} onChange={(e) => set('tag', e.target.value)} />
                </label>
              </div>
            )}
          </div>

          <div className="field">
            <span>3 · 누구에게 적용할까요</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="적용 대상">
              {DEPTS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="chip"
                  aria-pressed={draft.scope.includes(d)}
                  onClick={() => {
                    if (d === '전사') return set('scope', ['전사']);
                    const next = chipToggle(draft.scope.filter((x) => x !== '전사'), d);
                    set('scope', next.length ? next : ['전사']);
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
            <span className="t3" style={{ fontSize: 12.5 }}>
              부서별 적용은 아직 저장만 돼요. 지금은 누가 쓰는지 서버가 몰라서 어느 부서를 골라도 전사에 적용돼요.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(
              [
                ['ask', '보내기 전에 검토 창 띄우기', '직원이 바뀔 내용을 보고 "적용하기"를 눌러야 전송 · 끄면 자동으로 가려서 보냄'],
                ['exc', '예외 요청 받기', '막혔을 때 직원이 사유를 적어 보안 관리자에게 요청할 수 있어요'],
                ['notify', '보안 관리자에게 알림', '같은 사람이 10분 안에 3번 넘게 걸리면 알려요'],
              ] as const
            ).map(([k, t, s]) => (
              <div key={k} className="row-line" style={{ padding: '10px 0' }}>
                <div>
                  <div style={{ fontSize: 13.5 }}>{t}</div>
                  <div className="t3" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {s}
                  </div>
                </div>
                <Toggle on={draft.options[k]} label={t} onChange={(v) => set('options', { ...draft.options, [k]: v })} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (isNew) {
                  setMode('edit');
                  if (sel) setDraft(draftOf(sel));
                } else if (sel) {
                  setDraft(draftOf(sel));
                  toast('편집 내용을 되돌렸어요');
                }
              }}
            >
              {isNew ? '취소' : '되돌리기'}
            </button>
            <button
              type="button"
              className="btn btn-p"
              disabled={save.isPending || add.isPending}
              onClick={() => {
                if (!isNew) return save.mutate();
                if (!draft.name.trim()) return toast('규칙명을 먼저 적어 주세요', 'error');
                add.mutate();
              }}
            >
              {isNew ? '규칙 추가' : '변경으로 저장'}
            </button>
          </div>
        </section>

        <div style={{ flex: '2 1 360px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <section className="card">
            <div className="ch">
              <h2 className="ct">미리 시험하기</h2>
              <span className="t3" style={{ fontSize: 13 }}>
                검사 서버 규칙으로 확인 · 저장·전송하지 않음
              </span>
            </div>
            <label className="field">
              <span>시험 문장</span>
              <textarea className="ta" value={sample} onChange={(e) => setSample(e.target.value)} />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 8 }} className="t2">
              <input type="checkbox" checked={tplOn} onChange={(e) => setTplOn(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
              업종 묶음 규칙(전체 업종)도 같이 시험
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 10px', flexWrap: 'wrap', gap: 8 }}>
              <span className="lbl">결과</span>
              <button type="button" className="btn btn-sm btn-p" disabled={!sample.trim() || run.isPending} onClick={() => run.mutate(sample)}>
                {run.isPending ? '시험 중…' : '시험하기'}
              </button>
            </div>
            {run.error && <QueryState error={run.error} />}
            {result && (
              <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pieces
                  .filter((p) => p.span)
                  .map((p, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', fontSize: 13.5, padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,.5)' }}>
                      <span>
                        <b style={{ fontWeight: 500 }}>{p.text}</b>
                        <span className="t3"> · {p.span!.label}</span>
                      </span>
                      <span className={`badge ${p.span!.action === 'block' ? 'b-block' : p.span!.action === 'internal_only' ? 'b-internal' : 'b-redact'}`}>{ACTION_KO[p.span!.action]}</span>
                    </div>
                  ))}
                <div style={{ marginTop: 2, padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,.72)', fontSize: 13.5, lineHeight: 1.6 }}>
                  <span className="lbl" style={{ display: 'block', marginBottom: 4 }}>
                    외부로 나가는 문장
                  </span>
                  <span className="mono" style={{ fontSize: 13 }}>
                    {result.sanitized}
                  </span>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,.72)', fontSize: 13.5, lineHeight: 1.6 }}>
                  {result.route === 'block'
                    ? '차단할 값이 있어 보내지 않아요 · 직원에게 경고창이 떠요'
                    : result.spans.length === 0
                      ? '찾은 값이 없어 그대로 보내요'
                      : `${result.spans.length}개를 이름표로 바꿔서 ${result.route === 'internal' ? '내부 모델로' : ''} 보내요 · 차단할 값은 없어요`}
                </div>
              </div>
            )}
            {!result && !run.error && (
              <div className="t3" style={{ fontSize: 13.5 }}>
                "시험하기"를 누르면 검사 서버가 무엇을 찾는지 보여 줘요. 여기서 만든 규칙은 서버에 아직 반영되지 않아 결과에 포함되지 않아요.
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
