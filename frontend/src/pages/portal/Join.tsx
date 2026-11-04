// 가입 신청: the public form the admin shares. Name, company mail and department only (no password): the admin decides in the console.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Select } from '../../components/Select';
import { gateway } from '../../api/gateway';
import { errorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';

export function JoinPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dept, setDept] = useState('');
  const depts = useQuery({ queryKey: ['gw', 'departments'], queryFn: gateway.departments, retry: false });
  const send = useMutation({ mutationFn: () => gateway.joinMember({ name: name.trim(), email: email.trim(), dept: dept.trim() }) });

  function submit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }

  return (
    <div className="page-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <main className="glass card" style={{ width: 'min(440px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }} aria-label="가입 신청">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="sb-logo">
            <Icon name="shield" size={17} stroke="#fff" width={2} />
          </span>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Gateway 가입 신청</div>
        </div>
        {send.isSuccess ? (
          <div role="status">
            <h1 style={{ fontSize: 20, margin: '4px 0 6px' }}>신청했어요</h1>
            <p className="t2" style={{ margin: 0 }}>관리자가 확인하면 구성원으로 등록돼요. 비밀번호나 키는 받지 않아요.</p>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h1 style={{ fontSize: 20, margin: '4px 0 0' }}>회사 구성원으로 가입 신청</h1>
            <p className="t2" style={{ margin: 0, fontSize: 13.5 }}>이름·회사 메일·부서만 적어 주세요. 관리자가 승인하면 등록돼요.</p>
            <label className="field">
              <span>이름</span>
              <input className="in" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </label>
            <label className="field">
              <span>회사 메일</span>
              <input className="in" type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="name@company.com" />
            </label>
            <div className="field">
              <span>부서</span>
              <Select label="부서" value={dept} width="100%" onChange={setDept} options={[{ value: '', label: '선택 안 함' }, ...(depts.data?.departments ?? []).map((d) => ({ value: d, label: d }))]} />
            </div>
            {send.isError && (
              <div className="err-box" role="alert">
                {errorMessage(send.error)}
              </div>
            )}
            <button type="submit" className="btn btn-p" disabled={send.isPending}>
              {send.isPending ? '보내는 중…' : '가입 신청'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
