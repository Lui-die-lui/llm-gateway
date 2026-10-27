// 07 구성원 · 가입 승인 (Users.dc.html). Mock: the gateway has no accounts, companies or roles yet.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import type { Decision, Member } from '../../api/consoleTypes';
import { MockBadge } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { qk, useCompany, useJoinRequests } from '../../features/queries';

const AV_COLORS = ['#DBE4FF', '#D6E8F5', '#D7EFE3', '#F3E6D0', '#F6DADA', 'rgba(15,26,43,.07)'];
const STATUS_KO: Record<Member['status'], string> = { active: '사용 중', idle: '30일 넘게 안 씀', inactive: '비활성' };

export function UsersPage() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const company = useCompany();
  const joins = useJoinRequests();
  const members = useQuery({ queryKey: qk.members, queryFn: consoleApi.members });
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');

  const refresh = (...keys: (readonly unknown[])[]) => {
    keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    qc.invalidateQueries({ queryKey: qk.adminLog });
  };
  const fail = (e: unknown) => toast(errorMessage(e), 'error');

  const decide = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Decision }) => consoleApi.decideJoin(id, d),
    onSuccess: (r, { d }) => {
      refresh(qk.joins, qk.company);
      toast(d === 'approved' ? `${r.name} 님 가입을 승인했어요 · 확장에 알림` : `${r.name} 님 요청을 거절했어요 · 사유 전달`);
    },
    onError: fail,
  });
  const role = useMutation({
    mutationFn: (m: Member) => consoleApi.setMemberRole(m.id, m.role === 'admin' ? 'member' : 'admin'),
    onSuccess: (m) => (refresh(qk.members), toast(`${m.name} · ${m.role === 'admin' ? '보안 관리자로 지정' : '직원으로 변경'}`)),
    onError: fail,
  });
  const status = useMutation({
    mutationFn: (m: Member) => consoleApi.setMemberStatus(m.id, m.status === 'inactive' ? 'active' : 'inactive'),
    onSuccess: (m) => (refresh(qk.members), toast(`${m.name} · ${m.status === 'inactive' ? '비활성화했어요 · 로그인 막힘' : '다시 켰어요'}`)),
    onError: fail,
  });
  const regen = useMutation({
    mutationFn: consoleApi.regenerateCode,
    onSuccess: () => (refresh(qk.company), toast('새 회사 코드를 만들었어요 · 이전 코드는 더 이상 신청에 못 써요')),
    onError: fail,
  });

  const reqs = joins.data ?? [];
  const pending = reqs.filter((r) => !r.decision).length;
  const all = members.data ?? [];
  const depts = useMemo(() => [...new Set((members.data ?? []).map((m) => m.dept))], [members.data]);
  const shown = all.filter((m) => (!dept || m.dept === dept) && (!q.trim() || `${m.name} ${m.email}`.toLowerCase().includes(q.trim().toLowerCase())));
  const c = company.data;

  async function onRole(m: Member) {
    if (m.owner) return toast('소유자 역할은 바꿀 수 없어요', 'error');
    const toAdmin = m.role !== 'admin';
    const ok = await confirm({
      title: '역할 바꾸기',
      body: toAdmin ? `${m.name} 님을 보안 관리자로 지정해요. 콘솔 로그인과 규칙·예외 승인을 할 수 있게 돼요.` : `${m.name} 님을 직원으로 바꿔요. 콘솔에 더 이상 들어올 수 없어요.`,
      ok: toAdmin ? '관리자로 지정' : '직원으로 변경',
    });
    if (ok) role.mutate(m);
  }

  async function onStatus(m: Member) {
    if (m.status !== 'inactive') {
      const ok = await confirm({ title: '구성원 비활성화', body: `${m.name} 님의 로그인을 막아요. 지금까지의 기록은 그대로 남아요.`, ok: '비활성화', danger: true });
      if (!ok) return;
    }
    status.mutate(m);
  }

  async function onReject(id: string, name: string) {
    const ok = await confirm({ title: '가입 요청 거절', body: `${name} 님에게 거절 사유가 전달되고 관리자 작업 기록에 남아요.`, ok: '거절', danger: true });
    if (ok) decide.mutate({ id, d: 'rejected' });
  }

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">회사 / 구성원 · 가입 승인</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
            <h1 style={{ margin: 0 }}>구성원 · 가입 승인</h1>
            <MockBadge />
          </div>
          <p className="t2">{c?.name ?? '…'} · 회사 코드로 들어온 가입 요청을 승인하고, 누가 관리자인지 정해요</p>
        </div>
      </header>

      <section aria-label="요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 16 }}>
        {[
          ['구성원', String(c?.members ?? '…'), `보안 관리자 ${all.filter((m) => m.role === 'admin').length} · 직원 ${(c?.members ?? 0) - all.filter((m) => m.role === 'admin').length}`, 'var(--ink)'],
          ['가입 승인 대기', String(pending), pending ? '오래된 요청부터 확인' : '모두 처리함', pending ? '#B45309' : '#047857'],
          ['30일 넘게 안 씀', String(all.filter((m) => m.status === 'idle').length), '비활성으로 바꾸기 권장', 'var(--ink-3)'],
          ['비활성', String(all.filter((m) => m.status === 'inactive').length), '로그인 막힘 · 기록은 남음', 'var(--ink-3)'],
        ].map(([l, v, n, col]) => (
          <div key={l} className="card" style={{ padding: '14px 16px' }}>
            <div className="lbl">{l}</div>
            <div className="mono" style={{ fontSize: 24, marginTop: 6, color: col }}>
              {v}
            </div>
            <div className="t3" style={{ fontSize: 12, marginTop: 4 }}>
              {n}
            </div>
          </div>
        ))}
      </section>

      <div className="row-wrap top">
        <section className="card" style={{ flex: '3 1 620px', padding: '14px 8px 8px' }}>
          <div className="ch" style={{ padding: '0 10px' }}>
            <h2 className="ct">
              가입 요청{' '}
              <span className="t3" style={{ fontWeight: 400, fontSize: 12.5 }}>
                · 승인해야 보호가 켜지고 정책을 받아요
              </span>
            </h2>
            <span className="t3" style={{ fontSize: 12 }}>
              {pending}건 대기
            </span>
          </div>
          <QueryState isLoading={joins.isLoading} error={joins.error} />
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>신청자</th>
                  <th>부서</th>
                  <th>신청</th>
                  <th>확인</th>
                  <th className="num">결정</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span className="av">{r.name.slice(0, 1)}</span>
                        <span>
                          <span style={{ fontWeight: 500 }}>{r.name}</span>
                          <span className="t3 mono" style={{ display: 'block', fontSize: 11 }}>
                            {r.email}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td>{r.dept}</td>
                    <td className="t2">{r.when}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 120 }}>
                      <span style={{ fontSize: 12, lineHeight: 1.5, color: r.warn ? '#B91C1C' : '#047857' }}>{r.check}</span>
                    </td>
                    <td className="num">
                      {r.decision ? (
                        <span className={`badge ${r.decision === 'approved' ? 'b-clean' : 'b-block'}`}>{r.decision === 'approved' ? '승인함' : '거절함'}</span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button type="button" className="btn btn-sm" aria-label={`${r.name} 가입 거절`} disabled={decide.isPending} onClick={() => onReject(r.id, r.name)}>
                            거절
                          </button>
                          <button type="button" className="btn btn-sm btn-p" aria-label={`${r.name} 가입 승인`} disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, d: 'approved' })}>
                            승인
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="t3" style={{ fontSize: 11.5, lineHeight: 1.6, margin: '10px 10px 4px' }}>
            회사 메일 주소({c?.mailDomain ?? '@example.com'})가 아니면 "확인"에 경고가 떠요. 거절하면 사유가 신청자에게 전달되고 관리자 작업 기록에 남아요.
          </p>
        </section>

        <section className="card" style={{ flex: '2 1 340px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 className="ct">회사 코드</h2>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.75)' }}>
            <b className="mono" style={{ fontSize: 20, letterSpacing: '.06em', flex: 1 }}>
              {c?.code ?? '…'}
            </b>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(c?.code ?? '');
                  toast('회사 코드를 복사했어요');
                } catch {
                  toast('복사하지 못했어요 · 직접 선택해서 복사하세요', 'error');
                }
              }}
            >
              복사
            </button>
          </div>
          <p className="t2" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
            직원이 가입할 때 넣는 코드예요. 코드만으로는 들어올 수 없고, 여기서 승인해야 해요.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start' }}
            disabled={regen.isPending}
            onClick={async () => {
              if (await confirm({ title: '새 코드로 바꾸기', body: '바꾸면 이전 코드로는 새로 신청할 수 없어요. 이미 가입한 사람은 그대로예요.', ok: '새 코드 만들기' })) regen.mutate();
            }}
          >
            새 코드로 바꾸기
          </button>
          <span className="t3" style={{ fontSize: 11.5 }}>
            바꾸면 이전 코드로는 새로 신청할 수 없어요. 이미 가입한 사람은 그대로예요.
          </span>
        </section>
      </div>

      <section className="card" style={{ padding: '14px 8px 8px' }}>
        <div className="ch" style={{ padding: '0 10px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 className="ct">구성원</h2>
            <label>
              <span className="sr-only">구성원 검색</span>
              <input className="in" style={{ width: 220, height: 34 }} placeholder="이름, 이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <select className="sel" aria-label="부서" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">전체 부서</option>
              {depts.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <span className="t3" style={{ fontSize: 12 }}>
            {c?.members ?? '…'}명 중 {shown.length}명 표시
          </span>
        </div>
        <QueryState isLoading={members.isLoading} error={members.error} />
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>부서</th>
                <th>역할</th>
                <th>상태</th>
                <th>마지막 사용</th>
                <th>
                  <span className="sr-only">작업</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && members.data && (
                <tr>
                  <td colSpan={6} className="empty">
                    조건에 맞는 구성원이 없어요
                  </td>
                </tr>
              )}
              {shown.map((m, i) => (
                <tr key={m.id}>
                  <td>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span className="av" style={{ background: AV_COLORS[i % AV_COLORS.length] }}>
                        {m.name.slice(0, 1)}
                      </span>
                      <span>
                        <span style={{ fontWeight: 500 }}>{m.name}</span>
                        <span className="t3 mono" style={{ display: 'block', fontSize: 11 }}>
                          {m.email}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td>{m.dept}</td>
                  <td>
                    <button type="button" className={`badge ${m.role === 'admin' ? 'b-accent' : 'b-muted'}`} aria-label={`${m.name} 역할 바꾸기 (지금: ${m.role === 'admin' ? '보안 관리자' : '직원'})`} onClick={() => onRole(m)}>
                      {m.owner ? '보안 관리자 · 소유자' : m.role === 'admin' ? '보안 관리자' : '직원'}
                    </button>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: m.status === 'active' ? '#047857' : '#B45309' }}>{STATUS_KO[m.status]}</span>
                  </td>
                  <td className="t2">{m.last}</td>
                  <td>
                    <button type="button" className="btn btn-sm" aria-label={`${m.name} ${m.status === 'inactive' ? '다시 켜기' : '비활성화'}`} disabled={m.owner || status.isPending} onClick={() => onStatus(m)}>
                      {m.status === 'inactive' ? '다시 켜기' : '비활성화'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
        <div>
          <div className="lbl">역할은 두 가지</div>
          <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.7 }}>
            <b>보안 관리자</b> · 콘솔 로그인, 가입 승인, 규칙·예외 승인, 설정 변경
            <br />
            <b>직원</b> · 확장 사용, 내 기록 보기, 예외 요청
          </p>
        </div>
        <div>
          <div className="lbl">소유자</div>
          <p className="t2" style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.7 }}>
            회사를 등록한 관리자예요. 다른 관리자를 지정하거나 뺄 수 있고, 마지막 관리자는 뺄 수 없어요. 역할 표시를 누르면 바뀌어요.
          </p>
        </div>
        <div>
          <div className="lbl">아무도 못 보는 것</div>
          <p className="t2" style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.7 }}>
            프롬프트 원문과 원래 값은 저장하지 않아서 관리자도 볼 수 없어요.
          </p>
        </div>
      </section>
    </>
  );
}
