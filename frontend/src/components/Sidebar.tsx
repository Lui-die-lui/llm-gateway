// Console navigation (Sidebar.dc.html). Active item comes from the route.
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth';
import { useCompany, useHealth, usePendingCounts } from '../features/queries';
import { Icon, type IconName } from './Icon';

interface Item {
  to: string;
  label: string;
  icon: IconName;
  count?: number;
}

function NavItem({ item }: { item: Item }) {
  return (
    <NavLink to={item.to} end className="sb-item">
      <Icon name={item.icon} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.count ? (
        <span className="sb-count" aria-label={`대기 ${item.count}건`}>
          {item.count}
        </span>
      ) : null}
    </NavLink>
  );
}

export function Sidebar() {
  const { session, signOut } = useAuth();
  const nav = useNavigate();
  const counts = usePendingCounts();
  const company = useCompany();
  const health = useHealth();

  const groups: { label: string; items: Item[] }[] = [
    {
      label: 'MONITOR',
      items: [
        { to: '/console', label: '개요', icon: 'overview' },
        { to: '/console/live', label: '실시간 모니터링', icon: 'live' },
        { to: '/console/logs', label: '기록', icon: 'logs' },
        { to: '/console/reports', label: '분석 리포트', icon: 'reports' },
      ],
    },
    {
      label: 'POLICY',
      items: [
        { to: '/console/policy', label: '정책 엔진', icon: 'policy' },
        { to: '/console/policy/basic', label: '정책 엔진 2 · 기본 규칙', icon: 'policy2' },
        { to: '/console/exceptions', label: '예외 요청', icon: 'exceptions', count: counts.exceptions },
      ],
    },
    { label: 'COMPANY', items: [{ to: '/console/users', label: '구성원 · 가입 승인', icon: 'users', count: counts.joins }] },
  ];

  const up = health.isSuccess;
  const healthText = health.isLoading ? '검사 서버 확인 중' : up ? '검사 서버 정상' : '검사 서버 연결 안 됨';

  return (
    <nav className="sidebar" aria-label="관리자 메뉴">
      <NavLink to="/console" end className="sb-brand" aria-label="Gateway 개요로">
        <span className="sb-logo">
          <Icon name="shield" size={17} stroke="#fff" width={2} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>Gateway</span>
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: '.08em', color: 'var(--ink-3)' }}>
            SECURITY CONSOLE
          </span>
        </span>
      </NavLink>
      {groups.map((g) => (
        <div key={g.label} className="sb-group">
          <div className="sb-group-label">{g.label}</div>
          {g.items.map((it) => (
            <NavItem key={it.to} item={it} />
          ))}
        </div>
      ))}
      <div style={{ flex: 1, minHeight: 24 }} />
      <div className="sb-company">
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{company.data?.name ?? '…'}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--ink-2)' }}>
          <span>회사 코드</span>
          <span className="mono" style={{ color: 'var(--ink)' }}>
            {company.data?.code ?? '…'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
          <span className="sb-dot" style={{ background: up ? '#047857' : health.isLoading ? '#8A94A3' : '#DC2626' }} />
          {healthText} · 구성원 {company.data?.members ?? '…'}명
        </div>
      </div>
      <div style={{ height: 8 }} />
      <NavItem item={{ to: '/console/settings', label: '설정', icon: 'settings' }} />
      <div className="sb-user">
        <span className="av">{session?.user.name.slice(0, 1) ?? '?'}</span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{session?.user.name}</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session?.user.email}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            signOut();
            nav('/login');
          }}
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flex: '0 0 auto', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', padding: '6px 8px', borderRadius: 8, background: 'rgba(15,26,43,.05)', border: 0, cursor: 'pointer' }}
        >
          로그아웃
        </button>
      </div>
    </nav>
  );
}
