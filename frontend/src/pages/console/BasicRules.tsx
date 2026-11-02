// 05-2 정책 엔진 2 · 기본 규칙 고르기 (Policy2.dc.html).
// Rule list: industry rules from GET /v1/industries, built-ins from GET /v1/rules/builtin. Status strip: /health, /v1/config.
// Switches are real (GET/PUT /v1/policy/builtin): a rule that is off stops matching for every request. Industry rules still
// only apply to requests that name the industry (extension popup / X-Gateway-Industry).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import { gateway } from '../../api/gateway';
import { Help, Seg } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { industryGroup, useBuiltinGroups, useIndustries, type CatalogGroup } from '../../features/catalog';
import { useFeedback } from '../../features/feedback';
import { ACTION_KO } from '../../features/format';
import { qk, useHealth } from '../../features/queries';
import './basic-rules.css';

type Cat = 'all' | CatalogGroup['id'];
const CATS = [
  ['all', '전체'],
  ['basic', '기본 정보'],
  ['secret', '보안 정보'],
  ['industry', '업종 묶음'],
] as const;
const ACT_CLS = { redact: 'b-redact', block: 'b-block', internal_only: 'b-internal', log: 'b-clean' } as const;

export function BasicRulesPage() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const industries = useIndustries();
  const builtin = useBuiltinGroups();
  const health = useHealth();
  const config = useQuery({ queryKey: qk.config, queryFn: gateway.config });
  const [cat, setCat] = useState<Cat>('all');

  const groups = useMemo(
    () => (builtin && industries.data ? [...builtin, industryGroup(industries.data)] : []),
    [builtin, industries.data],
  );
  const defaults = useMemo(() => Object.fromEntries(groups.flatMap((g) => g.rules.map((r) => [r.id, r.defaultOn]))), [groups]);
  const applied = useQuery({ queryKey: [...qk.basicRules, Object.keys(defaults).length], queryFn: () => consoleApi.basicRules(defaults), enabled: groups.length > 0 });

  const [cur, setCur] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (applied.data) setCur(applied.data.applied);
  }, [applied.data]);

  const base = applied.data?.applied ?? {};
  const changes = Object.keys(cur).filter((k) => !!cur[k] !== !!base[k]);
  const onCount = Object.values(cur).filter(Boolean).length;
  const total = Object.keys(defaults).length;

  const apply = useMutation({
    mutationFn: () => consoleApi.applyBasicRules(cur),
    onSuccess: () => {
      toast(`${changes.length}건을 적용했어요 · 직원 확장이 몇 분 안에 받아요 · 관리자 작업에 기록`);
      qc.invalidateQueries({ queryKey: qk.basicRules });
      qc.invalidateQueries({ queryKey: qk.adminLog });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const c = config.data;
  const status = [
    { label: '검사 서버', value: health.isSuccess ? '정상' : health.isLoading ? '확인 중' : '연결 안 됨', ok: health.isSuccess },
    { label: '답변 검사', value: c ? (c.response_scan ? '켜짐' : '꺼짐') : '…', ok: !!c?.response_scan },
    { label: '관리자 토큰', value: c ? (c.admin_protected ? '보호 중' : '열려 있음') : '…', ok: !!c?.admin_protected },
  ];

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">정책 / 정책 엔진 2</div>
          <h1>정책 엔진 2 · 기본 규칙 고르기</h1>
          <p className="t2">
            우리가 미리 만들어 둔 규칙이에요. 쓸 규칙만 체크하고 "적용"을 누르면 돼요. 직접 만드는 규칙은 <Link to="/console/policy">정책 엔진</Link>에서 해요.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="t3" style={{ fontSize: 13.5 }}>
            전체 {total}개 중 {onCount}개 사용
          </span>
          {changes.length > 0 && (
            <button type="button" className="btn" onClick={() => setCur({ ...base })}>
              되돌리기
            </button>
          )}
          <button type="button" className="btn btn-p" disabled={!changes.length || apply.isPending} onClick={() => apply.mutate()}>
            {changes.length ? `변경 ${changes.length}건 적용` : '바뀐 것 없음'}
          </button>
          <Help label="적용 방법 도움말" title="적용 방법">
            <ol>
              <li>쓸 규칙만 체크해요 · 아직 적용 안 됨</li>
              <li>"변경 n건 적용"을 눌러요</li>
              <li>직원 확장이 몇 분 안에 새 규칙을 받아요</li>
              <li>바꾼 내용은 기록 › 관리자 작업에 남아요</li>
            </ol>
          </Help>
        </div>
      </header>

      <section className="card" aria-label="검사 서버 상태" style={{ padding: '12px 16px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="lbl">서버 상태 · GET /health · /v1/config</span>
        {status.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
            <span className="sb-dot" style={{ background: s.ok ? '#047857' : '#A9B6C8' }} aria-hidden="true" />
            <span className="t2">{s.label}</span>
            <b style={{ fontWeight: 600 }}>{s.value}</b>
          </span>
        ))}
      </section>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Seg label="분류" options={CATS} value={cat} onChange={setCat} />
        <span className="t3" style={{ fontSize: 13, marginLeft: 'auto' }}>
          회색 줄은 꺼진 규칙 · 바꾼 줄은 파란 테두리
        </span>
      </div>

      <QueryState isLoading={industries.isLoading} error={industries.error} onRetry={() => industries.refetch()} />

      {groups
        .filter((g) => cat === 'all' || cat === g.id)
        .map((g) => (
          <section key={g.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-labelledby={`grp-${g.id}`}>
            <div className="p2cat">
              <div>
                <h2 className="ct" id={`grp-${g.id}`}>
                  {g.name}
                </h2>
                <div className="t3" style={{ fontSize: 13, marginTop: 3 }}>
                  {g.desc}
                </div>
              </div>
              <span className="t3" style={{ fontSize: 13 }}>
                {g.rules.length}개 중 {g.rules.filter((r) => cur[r.id]).length}개 사용
              </span>
            </div>
            <div className="p2row p2head" aria-hidden="true">
              <span />
              <span className="lbl">규칙명</span>
              <span className="lbl">무엇을 찾나 · 예시</span>
              <span className="lbl" style={{ textAlign: 'right' }}>
                처리
              </span>
            </div>
            {g.rules.length === 0 && <div className="empty">이 분류에 규칙이 없어요</div>}
            {g.rules.map((r) => {
              const on = !!cur[r.id];
              const changed = on !== !!base[r.id];
              return (
                <label key={r.id} className={`p2row${on ? '' : ' off'}${changed ? ' changed' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => setCur({ ...cur, [r.id]: !on })} aria-label={`${r.name} 사용`} />
                  <span className="nm" style={{ fontWeight: 600, fontSize: 14 }}>
                    {r.name}
                    {changed && <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--link)' }}>{on ? '켜기 · 적용 전' : '끄기 · 적용 전'}</span>}
                  </span>
                  <span style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                    {r.desc}
                    <span className="mono" style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-mute)' }}>
                      예: {r.example}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span className={`badge ${ACT_CLS[r.action]}`}>{ACTION_KO[r.action]}</span>
                  </span>
                </label>
              );
            })}
          </section>
        ))}
    </>
  );
}
