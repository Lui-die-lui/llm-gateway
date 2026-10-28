import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers, makeQueryClient } from '../app/Providers';
import { routes } from '../app/router';

function renderAt(path: string) {
  // The gateway is not running in unit tests: every real endpoint answers with an empty body.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
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
    const router = renderAt('/console/users');
    expect(await screen.findByRole('heading', { name: '관리자 계정으로 로그인' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('아이디 (회사 이메일)'), 'admin@example.com');
    await user.type(screen.getByLabelText('비밀번호'), 'test1234');
    await user.click(screen.getByRole('button', { name: '다음' }));
    await user.click(await screen.findByRole('button', { name: '관리자 콘솔 열기 →' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/console/users'));
    expect(await screen.findByRole('heading', { name: '구성원 · 가입 승인' })).toBeInTheDocument();
  });

  it('approves a join request and updates the sidebar badge', async () => {
    sessionStorage.setItem('gw.console.session', JSON.stringify({ user: { name: '보안관리자', email: 'admin@example.com', role: 'admin', owner: true }, lastLogin: '', lastActive: Date.now() }));
    const user = userEvent.setup();
    renderAt('/console/users');
    const approve = await screen.findByRole('button', { name: '이서준 가입 승인' });
    expect(await screen.findByLabelText('대기 4건')).toBeInTheDocument();
    await user.click(approve);
    expect(await screen.findByText(/이서준 님 가입을 승인했어요/)).toBeInTheDocument();
    expect(await screen.findByLabelText('대기 3건')).toBeInTheDocument();
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
