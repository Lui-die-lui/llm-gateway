import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  const baseServer = (): Record<string, unknown> => ({
    values: { response_scan: true, vault_ttl_minutes: 30, once_valid_hours: 24, keep_decided_days: 180, notify_new_exception: true },
    limits: { vault_ttl_minutes: { min: 5, max: 240 }, once_valid_hours: { min: 1, max: 168 }, keep_decided_days: { min: 7, max: 730 } },
    slack: { configured: false, host: null, source: null, console_link: false },
    keys: { env_keys: 0, required: false, list: [] },
    data: { audit_events: 12, exception_requests: 3 },
    log: [{ t: 1_700_000_000, what: '답변 검사', detail: '꺼짐 → 켜짐' }],
    environment: { provider: 'openai', mock: false, admin_protected: true, max_text: 200000, cors_origins: ['http://localhost:3000'], stores_prompt_text: false },
  });
  /** A tiny stand-in for the gateway's settings endpoints: keeps state and records what the page sent. */
  function settingsServer() {
    const state = baseServer() as { values: Record<string, unknown>; slack: Record<string, unknown>; keys: { required: boolean; list: unknown[] } };
    const calls: { method: string; path: string; body: unknown }[] = [];
    const handler = (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/gw(?=\/)/, ''); // the dev server prefix is not part of the endpoint
      if (!path.startsWith('/v1/settings') && !(path.startsWith('/v1/audit/events') && init?.method === 'DELETE') && !(path === '/v1/exceptions' && init?.method === 'DELETE')) return undefined;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== 'GET') calls.push({ method, path, body });
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path === '/v1/settings' && method === 'PATCH') Object.assign(state.values, body);
      if (path === '/v1/settings/slack' && method === 'PUT') Object.assign(state.slack, body.url ? { configured: true, host: 'hooks.slack.com', source: 'console' } : { configured: false, host: null, source: null });
      if (path === '/v1/settings/keys' && method === 'POST') {
        state.keys = { required: true, list: [{ id: 1, name: body.name, tail: 'abcd', created: 1_700_000_000, revoked: false }] };
        return ok({ key: 'gw_NEWKEY-shown-once', item: (state.keys.list[0] as object) });
      }
      if (method === 'DELETE' && !path.startsWith('/v1/settings')) return ok({ deleted: 12 });
      if (method === 'DELETE') return ok({ ok: true });
      if (path === '/v1/settings/slack/test') return ok({ ok: true, message: 'Slack으로 보냈어요' });
      return ok(state);
    };
    return { handler, calls, state };
  }

  it('settings: change a number, save after the confirmation, and only the changed field is sent', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    const srv = settingsServer();
    renderAt('/console/settings', srv.handler);
    const ttl = await screen.findByLabelText('되돌리기 매핑 보관');
    expect(screen.getByRole('button', { name: '바뀐 것 없음' })).toBeDisabled();
    await user.clear(ttl);
    await user.type(ttl, '60');
    await user.click(screen.getByRole('button', { name: '변경 저장' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ vault_ttl_minutes: 60 }));
    expect(await screen.findByRole('button', { name: '바뀐 것 없음' })).toBeDisabled();
  });

  it('settings: a value outside the allowed range blocks saving and says why', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    const srv = settingsServer();
    renderAt('/console/settings', srv.handler);
    const ttl = await screen.findByLabelText('되돌리기 매핑 보관');
    await user.clear(ttl);
    await user.type(ttl, '1');
    expect(await screen.findByText('5~240분 사이로 적어 주세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '변경 저장' })).toBeDisabled();
    expect(srv.calls).toHaveLength(0);
  });

  it('settings: turning the answer check off asks first and warns what it means', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    const srv = settingsServer();
    renderAt('/console/settings', srv.handler);
    await user.click(await screen.findByLabelText('답변 검사'));
    await user.click(screen.getByRole('button', { name: '변경 저장' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText(/걸러 내지 못해요/)).toBeInTheDocument();
    await user.click(dlg.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(srv.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ response_scan: false }));
  });

  it('settings: the first access key warns that requests without one get blocked, then the key is shown once', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    const srv = settingsServer();
    renderAt('/console/settings', srv.handler);
    await user.click(await screen.findByRole('tab', { name: '접속 키' }));
    await user.type(await screen.findByLabelText('키 이름'), '인사팀 앱');
    await user.click(screen.getByRole('button', { name: '키 만들기' }));
    const dlg = within(await screen.findByRole('dialog'));
    expect(dlg.getByText(/키 없는 요청.*막혀요/)).toBeInTheDocument();
    await user.click(dlg.getByRole('button', { name: '만들기' }));
    expect(await screen.findByDisplayValue('gw_NEWKEY-shown-once')).toBeInTheDocument();
    expect(srv.calls.find((c) => c.path === '/v1/settings/keys')?.body).toEqual({ name: '인사팀 앱' });
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByDisplayValue('gw_NEWKEY-shown-once')).not.toBeInTheDocument();
    expect(screen.getByText(/…abcd/)).toBeInTheDocument(); // afterwards only the name and the last four characters
  });

  it('settings: clearing data shows how many records go and calls the real delete', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    const srv = settingsServer();
    renderAt('/console/settings', srv.handler);
    await user.click(await screen.findByRole('tab', { name: '데이터 · 기록' }));
    await screen.findByText(/지금 12건/);
    const [firstWipe] = screen.getAllByRole('button', { name: '모두 지우기' });
    if (!firstWipe) throw new Error('no wipe button');
    await user.click(firstWipe);
    expect(await screen.findByText(/12건이 지워지고 되돌릴 수 없어요/)).toBeInTheDocument();
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '모두 지우기' }));
    await waitFor(() => expect(srv.calls.some((c) => c.method === 'DELETE' && c.path === '/v1/audit/events')).toBe(true));
  });

  it('settings: saves and clears the Slack webhook, tests it, and never shows the address', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    const srv = settingsServer();
    renderAt('/console/settings', srv.handler);
    await user.click(await screen.findByRole('tab', { name: '알림' }));
    expect(await screen.findByRole('button', { name: 'Slack으로 테스트 보내기' })).toBeDisabled();
    await user.type(screen.getByLabelText('Slack 웹훅 주소'), 'https://hooks.slack.com/services/T/B/SECRET');
    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(srv.calls.find((c) => c.path === '/v1/settings/slack')?.body).toEqual({ url: 'https://hooks.slack.com/services/T/B/SECRET' }));
    expect(await screen.findByText(/보낼 곳: hooks\.slack\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/SECRET/)).not.toBeInTheDocument(); // the input is emptied after saving
    await user.click(screen.getByRole('button', { name: 'Slack으로 테스트 보내기' }));
    expect(await screen.findByText('Slack으로 보냈어요')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '지우기' }));
    await waitFor(() => expect(srv.calls.some((c) => c.path === '/v1/settings/slack' && (c.body as { url: string }).url === '')).toBe(true));
  });

  it('settings: one tab at a time, the chosen tab survives a reload, and an unsaved change is marked on its tab', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    window.history.replaceState(null, '', '#keys');
    renderAt('/console/settings', settingsServer().handler);
    expect(await screen.findByRole('tab', { name: '접속 키', selected: true })).toBeInTheDocument(); // came back to the tab in the address
    expect(screen.getByLabelText('키 이름')).toBeInTheDocument();
    expect(screen.queryByLabelText('답변 검사')).not.toBeInTheDocument(); // other tabs' sections are not on the page
    await user.click(screen.getByRole('tab', { name: '일반' }));
    expect(window.location.hash).toBe('#general');
    expect(screen.queryByLabelText('키 이름')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('답변 검사'));
    await user.click(screen.getByRole('tab', { name: '알림' }));
    expect(screen.getByRole('tab', { name: /일반/ })).toContainElement(screen.getByLabelText('저장 안 된 변경'));
    expect(screen.getByRole('button', { name: '변경 저장' })).toBeEnabled(); // the save button stays reachable from every tab
    window.history.replaceState(null, '', '#');
  });

  it('settings: the idle logout is a real browser setting the console reads', async () => {
    sessionStorage.setItem('gw.console.session', SESSION);
    const user = userEvent.setup();
    renderAt('/console/settings', settingsServer().handler);
    await user.selectOptions(await screen.findByLabelText('자동 로그아웃'), '60');
    expect(localStorage.getItem('gw.console.idleMinutes')).toBe('60');
    localStorage.removeItem('gw.console.idleMinutes');
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
