import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers, makeQueryClient } from '../app/Providers';
import { routes } from '../app/router';

function renderAt(path: string, extra?: (url: string, init?: RequestInit) => Response | undefined) {
  // The gateway is not running in unit tests: every real endpoint answers with an empty body.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const over = extra?.(url, init);
      if (over) return over;
      if (url.includes('/v1/rules/builtin')) {
        const rule = { id: 'b:이메일', name: '이메일', desc: '메일 주소', example: 'name@example.com', labels: ['이메일'], action: 'redact' };
        return new Response(JSON.stringify({ groups: [{ id: 'basic', name: '기본 정보', desc: '', rules: [rule] }] }), { status: 200 });
      }
      if (url.includes('/v1/policy/builtin')) return new Response(JSON.stringify({ version: 0, applied: {} }), { status: 200 });
      const body = url.includes('/v1/audit/events') || url.includes('/timeseries') || url.includes('/v1/industries') ? [] : url.includes('/summary') ? { requests: 0, by_status: {}, by_route: {}, by_industry: {}, findings: [], redacted_items: 0, response_redacted_items: 0 } : { status: 'ok' };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers client={makeQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}

describe('console', () => {
  it('guards console routes and returns to the requested page after login', async () => {
    const user = userEvent.setup();
    const router = renderAt('/console/exceptions');
    expect(await screen.findByRole('heading', { name: '관리자 계정으로 로그인' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('아이디 (회사 이메일)'), 'admin@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'test1234');
    await user.click(screen.getByRole('button', { name: '다음' }));
    await user.click(await screen.findByRole('button', { name: '관리자 콘솔 열기 →' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/console/exceptions'));
    expect(await screen.findByRole('heading', { name: '예외 요청' })).toBeInTheDocument();
  });

  it('has no pages for made-up data: members and the personal portal history are gone', async () => {
    sessionStorage.setItem('gw.console.session', JSON.stringify({ user: { name: '보안관리자', email: 'admin@example.com', role: 'admin', owner: true }, lastLogin: '', lastActive: Date.now() }));
    const router = renderAt('/console/users');
    await waitFor(() => expect(router.state.location.pathname).toBe('/console'));
    expect(screen.queryByText('구성원 · 가입 승인')).not.toBeInTheDocument();
  });

  const SESSION = JSON.stringify({ user: { name: '보안관리자', email: 'admin@example.com', role: 'admin', owner: true }, lastLogin: '', lastActive: Date.now() });
  const SERVER = (slack: { configured: boolean; host: string | null; console_link: boolean }) => ({
    upstream: { provider: 'openai', mock: false, internal_route: false },
    protection: { caller_auth: true, caller_keys: 2, admin_protected: true, response_scan: true, max_text: 200000, cors_origins: ['http://localhost:3000'] },
    retention: { vault_ttl_seconds: 1800, once_valid_seconds: 86400, decided_keep_days: 180, stores_prompt_text: false },
    slack,
  });

  it('settings page shows what the server really has, and Slack is off without a webhook', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    renderAt('/console/settings', (url) => (url.endsWith('/v1/settings') ? new Response(JSON.stringify(SERVER({ configured: false, host: null, console_link: false })), { status: 200 }) : undefined));
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument();
    expect(await screen.findByText('키 2개 등록됨 · 키 없이는 가림·복원을 쓸 수 없어요')).toBeInTheDocument();
    expect(screen.getAllByText('30분')).toHaveLength(2); // vault TTL and the console's idle logout
    expect(screen.getByText('1일')).toBeInTheDocument(); // one-use approval validity
    expect(screen.getByText('저장 안 함')).toBeInTheDocument();
    expect(screen.getByText('연결 안 됨')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Slack으로 테스트 보내기' })).toBeDisabled();
    expect(screen.queryByText(/hooks\.slack\.com\/services/)).not.toBeInTheDocument();
  });

  it('sends a Slack test line when a webhook is set and reports the answer', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    let posted = 0;
    renderAt('/console/settings', (url, init) => {
      if (url.endsWith('/v1/settings')) return new Response(JSON.stringify(SERVER({ configured: true, host: 'hooks.slack.com', console_link: true })), { status: 200 });
      if (url.endsWith('/v1/settings/slack/test') && init?.method === 'POST') {
        posted++;
        return new Response(JSON.stringify({ ok: true, message: 'Slack으로 보냈어요' }), { status: 200 });
      }
      return undefined;
    });
    expect(await screen.findByText('보낼 곳: hooks.slack.com (웹훅 주소는 보안상 보여 드리지 않아요)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Slack으로 테스트 보내기' }));
    expect(await screen.findByText('Slack으로 보냈어요')).toBeInTheDocument();
    expect(posted).toBe(1);
  });

  it('enables "변경 n건 적용" only after a basic rule changes', async () => {
    sessionStorage.setItem('gw.console.session', JSON.stringify({ user: { name: '보안관리자', email: 'admin@example.com', role: 'admin', owner: true }, lastLogin: '', lastActive: Date.now() }));
    const user = userEvent.setup();
    renderAt('/console/policy/basic');
    const none = await screen.findByRole('button', { name: '바뀐 것 없음' });
    expect(none).toBeDisabled();
    await user.click(await screen.findByLabelText('이메일 사용'));
    expect(screen.getByRole('button', { name: '변경 1건 적용' })).toBeEnabled();
  });
});
