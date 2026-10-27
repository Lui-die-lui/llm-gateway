// U8 치환 기록 자세히 (UserHistory.dc.html). In the real product these rows live only on the employee's device
// (the extension), with originals already partially hidden (홍*동). Here they come from the mock api.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '../../api/console';
import type { ReplaceHow } from '../../api/consoleTypes';
import { Seg } from '../../components/Controls';
import { QueryState } from '../../components/QueryState';
import { useFeedback } from '../../features/feedback';
import { qk } from '../../features/queries';
import { PortalNav } from './Portal';
import './portal.css';

const HOW_KO: Record<ReplaceHow, string> = { ph: '자리표시자', alias: '등록된 대체어', keep: '그대로 둠' };
const HOW_CLS: Record<ReplaceHow, string> = { ph: 'ph', alias: 'al', keep: 'kp' };
type Kind = 'all' | ReplaceHow | 'file';
const KINDS = [
  ['all', '전체'],
  ['ph', '자리표시자'],
  ['alias', '대체어'],
  ['keep', '그대로 둠'],
  ['file', '파일'],
] as const;
const RANGES = [
  [0, '오늘'],
  [1, '7일'],
  [2, '전체'],
] as const;

export function HistoryPage() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [range, setRange] = useState<0 | 1 | 2>(1);
  const [kind, setKind] = useState<Kind>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({ h1: true });
  const history = useQuery({ queryKey: qk.portal('history'), queryFn: portalApi.history });
  const aliases = useQuery({ queryKey: qk.portal('aliases'), queryFn: portalApi.aliases });
  const clear = useMutation({
    mutationFn: portalApi.clearHistory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.portal('history') });
      toast('이 기기의 치환 기록을 지웠어요');
    },
  });

  const maxDay = [0, 6, 999][range] as number;
  const list = (history.data ?? []).filter((e) => {
    if (e.day > maxDay) return false;
    if (kind === 'all') return true;
    if (kind === 'file') return e.icon === 'FILE';
    return e.rows.some((r) => r.how === kind);
  });
  const rows = list.flatMap((e) => e.rows);
  const cnt = (h: ReplaceHow) => rows.filter((r) => r.how === h).length;

  return (
    <div className="page-bg portal">
      <PortalNav />
      <main className="portal-main" style={{ maxWidth: 1300 }}>
        <header className="page-head">
          <div>
            <nav aria-label="경로" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginBottom: 8 }}>
              <span className="t3">미니 패널</span>
              <span className="t3" aria-hidden="true">
                ›
              </span>
              <Link to="/me">전체 보기</Link>
              <span className="t3" aria-hidden="true">
                ›
              </span>
              <b aria-current="page">치환 기록 자세히</b>
            </nav>
            <div className="lbl">USER · 08</div>
            <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>치환 기록</h1>
            <p className="t2">검토 창에서 "적용하기"를 누른 내역이에요. 어떤 단어가 무엇으로 바뀌어 AI에게 갔는지 확인할 수 있어요.</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Seg label="기간" options={RANGES} value={range} onChange={setRange} />
            <Seg label="바꾼 방법" options={KINDS} value={kind} onChange={setKind} />
          </div>
        </header>

        <section aria-label="요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
          {[
            ['바뀐 단어', rows.length, '선택한 기간', 'var(--ink)'],
            ['자리표시자', cnt('ph'), '[사람_1] 형태', '#1D4ED8'],
            ['등록된 대체어', cnt('alias'), '고객A 형태', '#047857'],
            ['그대로 둠', cnt('keep'), '사용자가 원문 선택', '#B45309'],
          ].map(([l, v, n, c]) => (
            <div key={l as string} className="card" style={{ padding: '16px 18px' }}>
              <div className="lbl">{l}</div>
              <div className="mono" style={{ fontSize: 28, fontWeight: 600, marginTop: 6, color: c as string }}>
                {v}
              </div>
              <div className="t3" style={{ fontSize: 12, marginTop: 2 }}>
                {n}
              </div>
            </div>
          ))}
        </section>

        <div className="row-wrap top">
          <section style={{ flex: '3 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <QueryState isLoading={history.isLoading} error={history.error} />
            {list.map((e) => {
              const o = !!open[e.id];
              return (
                <article key={e.id} className="card" style={{ padding: '16px 18px' }}>
                  <button type="button" className="entry" aria-expanded={o} aria-controls={`hist-${e.id}`} onClick={() => setOpen({ ...open, [e.id]: !o })}>
                    <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                      <span
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 12,
                          display: 'grid',
                          placeItems: 'center',
                          font: "700 10px 'IBM Plex Mono',monospace",
                          flex: '0 0 auto',
                          ...(e.icon === 'FILE' ? { background: 'rgba(217,119,6,.12)', color: '#B45309' } : { background: 'rgba(37,99,235,.1)', color: '#1D4ED8' }),
                        }}
                      >
                        {e.icon}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <b style={{ display: 'block', fontSize: 14.5 }}>{e.title}</b>
                        <span className="t3" style={{ fontSize: 12 }}>
                          {e.when} · {e.site} · {e.kind}
                        </span>
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 10, alignItems: 'center', flex: '0 0 auto' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: 'rgba(37,99,235,.1)', color: '#1D4ED8' }}>{e.rows.length}개 치환</span>
                      <span aria-hidden="true" className="t3">
                        {o ? '−' : '+'}
                      </span>
                    </span>
                  </button>
                  {o && (
                    <div id={`hist-${e.id}`} style={{ marginTop: 12 }}>
                      <div className="tbl">
                        <table>
                          <thead>
                            <tr>
                              <th>원래 단어</th>
                              <th>종류</th>
                              <th>바뀐 값</th>
                              <th>방법</th>
                              <th>답변에서</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.rows.map((r, i) => (
                              <tr key={i}>
                                <td style={{ fontWeight: 600 }}>{r.masked}</td>
                                <td className="t2">{r.type}</td>
                                <td>
                                  <span className={HOW_CLS[r.how]}>{r.to}</span>
                                </td>
                                <td className="t2">{HOW_KO[r.how]}</td>
                                <td style={{ fontSize: 12, fontWeight: 600, color: r.result.includes('안 됨') || r.result === '원문 전송' ? '#B45309' : '#047857' }}>{r.result}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: '#fff', fontSize: 13, lineHeight: 1.7 }}>
                        <span className="lbl" style={{ display: 'block', marginBottom: 4 }}>
                          AI에게 간 문장
                        </span>
                        {e.wire.map((p, i) => (
                          <span key={i} className={p.how ? HOW_CLS[p.how] : undefined}>
                            {p.t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            {history.data && list.length === 0 && (
              <div className="card t2" style={{ textAlign: 'center', fontSize: 13 }}>
                이 조건에 맞는 기록이 없어요
              </div>
            )}
          </section>

          <aside style={{ flex: '2 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <section className="card">
              <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>등록된 대체어</h2>
              <p className="t3" style={{ margin: '0 0 12px', fontSize: 12 }}>
                관리자가 정한 값이에요. 검토 창에서 "등록된 대체어"를 고르면 이걸로 바뀌어요.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {aliases.data?.map((a) => (
                  <div key={a.type} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '9px 12px', borderRadius: 12, background: '#fff', fontSize: 12.5 }}>
                    <span>{a.type}</span>
                    <span className="al">{a.to}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>기록은 어디에 남나요?</h2>
              <div className="t2" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                이 화면의 기록은 <b style={{ color: 'var(--ink)' }}>내 컴퓨터에만 7일</b> 보관돼요. 원래 단어는 홍*동처럼 일부를 가려서 저장해요.
              </div>
              <div className="t2" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                회사 서버(관리자 콘솔)에는 <b style={{ color: 'var(--ink)' }}>언제 · 어떤 종류가 · 몇 개</b> 바뀌었는지만 남아요.
              </div>
              <button
                type="button"
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                disabled={!history.data?.length}
                onClick={async () => {
                  if (await confirm({ title: '이 기기 기록 지우기', body: '이 기기에 남은 치환 기록을 모두 지워요. 되돌릴 수 없어요.', ok: '지우기', danger: true })) clear.mutate();
                }}
              >
                이 기기 기록 지우기
              </button>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
