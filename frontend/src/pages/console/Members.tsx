// 구성원 · 가입 승인. Real: the people the company has, and the sign-up requests waiting for an admin's decision (GET /v1/members,
// approve / reject / remove). It is a directory the admin keeps; the gateway does not tell people apart by it.
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consoleApi } from '../../api/console';
import { errorMessage } from '../../api/client';
import type { MemberItem } from '../../api/consoleTypes';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { qk, useMembers, useServerSettings } from '../../features/queries';
import './settings.css';

const AV_COLORS = ['#DBE4FF', '#D6E8F5', '#D7EFE3', '#F3E6D0', '#F6DADA', 'rgba(15,26,43,.07)'];
const avatar = (m: MemberItem) => AV_COLORS[[...m.name].reduce((n, c) => n + c.charCodeAt(0), 0) % AV_COLORS.length];
const day = (t: number) => new Date(t * 1000).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' });
const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() / 1000 - t) / 60));
  return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

type Tab = 'members' | 'pending';
const tabFromHash = (): Tab | null => {
  const h = window.location.hash.replace('#', '');
  return h === 'members' || h === 'pending' ? h : null;
};

function Avatar({ m }: { m: MemberItem }) {
  return (
    <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: '50%', background: avatar(m), display: 'inline-grid', placeItems: 'center', fontSize: 13, fontWeight: 600, flex: '0 0 auto' }}>
      {[...m.name][0]}
    </span>
  );
}

export function MembersPage() {
  const q = useMembers();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const settings = useServerSettings();
  const data = q.data;
  const [picked, setPicked] = useState<Tab | null>(tabFromHash);
  const tab: Tab = picked ?? (data && data.pending.length > 0 ? 'pending' : 'members'); // waiting requests first, so they are not missed
  const choose = (t: Tab) => {
    setPicked(t);
    window.history.replaceState(null, '', `#${t}`);
  };
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');

  const refresh = () => {
    setPicked((p) => p ?? tab); // stay on the tab being worked in, even when its last waiting request has just been decided
    qc.invalidateQueries({ queryKey: qk.members });
    qc.invalidateQueries({ queryKey: qk.serverSettings });
  };
  const fail = (e: unknown) => toast(errorMessage(e), 'error');
  const approve = useMutation({ mutationFn: (m: MemberItem) => consoleApi.approveMember(m.id), onSuccess: (m) => (refresh(), toast(`${m.name} 님 가입을 승인했어요`)), onError: fail });
  const reject = useMutation({ mutationFn: (m: MemberItem) => consoleApi.rejectMember(m.id), onSuccess: (m) => (refresh(), toast(`${m.name} 님 신청을 반려했어요`)), onError: fail });
  const remove = useMutation({ mutationFn: (m: MemberItem) => consoleApi.removeMember(m.id), onSuccess: (m) => (refresh(), toast(`${m.name} 님을 구성원에서 뺐어요`)), onError: fail });

  const members = useMemo(() => data?.members ?? [], [data]);
  const pending = useMemo(() => data?.pending ?? [], [data]);
  const depts = useMemo(() => [...new Set(members.map((m) => m.dept).filter(Boolean))].sort(), [members]);
  const shown = members.filter((m) => (!dept || m.dept === dept) && (!search.trim() || `${m.name} ${m.email}`.toLowerCase().includes(search.trim().toLowerCase())));
  const joinUrl = `${window.location.origin}/join`;

  async function onReject(m: MemberItem) {
    if (await confirm({ title: `${m.name} 님 가입 반려`, body: '신청이 지워져요. 필요하면 다시 신청할 수 있어요.', ok: '반려', danger: true })) reject.mutate(m);
  }
  async function onRemove(m: MemberItem) {
    if (await confirm({ title: `${m.name} 님을 구성원에서 빼기`, body: '명단에서 지워져요. 다시 넣으려면 새로 가입 신청을 받아야 해요.', ok: '빼기', danger: true })) remove.mutate(m);
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast('가입 신청 주소를 복사했어요');
    } catch {
      toast('복사하지 못했어요 · 직접 선택해서 복사해 주세요', 'error');
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="crumb">시스템 / 구성원</div>
          <h1>구성원 · 가입 승인</h1>
          <p className="t2">회사 구성원 명단이에요 · 가입 신청은 여기서 승인하거나 반려해요</p>
        </div>
      </header>

      {!data ? (
        <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
          <div className="set-tabs" role="tablist" aria-label="구성원 구분">
            <button type="button" role="tab" id="tab-members" aria-selected={tab === 'members'} aria-controls="mem-panel" className={`set-tab${tab === 'members' ? ' on' : ''}`} onClick={() => choose('members')}>
              구성원 {members.length}명
            </button>
            <button type="button" role="tab" id="tab-pending" aria-selected={tab === 'pending'} aria-controls="mem-panel" className={`set-tab${tab === 'pending' ? ' on' : ''}`} onClick={() => choose('pending')}>
              가입 승인
              {pending.length > 0 && (
                <span className="sb-count" aria-label={`대기 ${pending.length}건`} style={{ marginLeft: 8 }}>
                  {pending.length}
                </span>
              )}
            </button>
          </div>

          <div id="mem-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {tab === 'members' && (
              <section className="card">
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 className="ct" style={{ margin: 0 }}>구성원</h2>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="in" aria-label="이름·메일 검색" placeholder="이름·메일 검색" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180 }} />
                    <select className="sel" aria-label="부서" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 130 }}>
                      <option value="">모든 부서</option>
                      {depts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {members.length === 0 ? (
                  <div className="empty">아직 구성원이 없어요 · 아래 주소로 가입 신청을 받을 수 있어요</div>
                ) : shown.length === 0 ? (
                  <div className="empty">찾는 사람이 없어요</div>
                ) : (
                  <table style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>부서</th>
                        <th>가입일</th>
                        <th className="num">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Avatar m={m} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 500 }}>{m.name}</div>
                                <div className="t3 mono" style={{ fontSize: 12.5 }}>
                                  {m.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>{m.dept || '—'}</td>
                          <td className="t2">{m.decided ? day(m.decided) : '—'}</td>
                          <td className="num">
                            <button type="button" className="btn btn-sm btn-d" aria-label={`${m.name} 구성원에서 빼기`} disabled={remove.isPending} onClick={() => onRemove(m)}>
                              빼기
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {tab === 'pending' && (
              <section className="card">
                <h2 className="ct">가입 승인 대기</h2>
                {pending.length === 0 ? (
                  <div className="empty">기다리는 가입 신청이 없어요</div>
                ) : (
                  <table style={{ marginTop: 12 }}>
                    <thead>
                      <tr>
                        <th>신청자</th>
                        <th>부서</th>
                        <th>신청</th>
                        <th className="num">결정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Avatar m={m} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 500 }}>{m.name}</div>
                                <div className="t3 mono" style={{ fontSize: 12.5 }}>
                                  {m.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>{m.dept || '—'}</td>
                          <td className="t2">{ago(m.created)}</td>
                          <td className="num">
                            <div style={{ display: 'inline-flex', gap: 8 }}>
                              <button type="button" className="btn btn-sm" aria-label={`${m.name} 가입 반려`} disabled={reject.isPending} onClick={() => onReject(m)}>
                                반려
                              </button>
                              <button type="button" className="btn btn-sm btn-p" aria-label={`${m.name} 가입 승인`} disabled={approve.isPending} onClick={() => approve.mutate(m)}>
                                승인
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            <section className="card">
              <h2 className="ct">가입 신청 주소</h2>
              <p className="sub" style={{ fontSize: 13.5, margin: '4px 0 10px' }}>
                이 주소를 직원에게 알려 주세요. 이름·회사 메일·부서만 받고, 신청하면 여기 "가입 승인"에 나타나요.
                {settings.data?.slack?.configured && settings.data.values?.notify_new_member ? ' Slack으로도 알려 드려요.' : ''}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="in mono" readOnly aria-label="가입 신청 주소" value={joinUrl} onFocus={(e) => e.currentTarget.select()} style={{ flex: '1 1 280px' }} />
                <button type="button" className="btn" onClick={copy}>
                  복사
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
