import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Providers, makeQueryClient } from '../app/Providers';
import { routes } from '../app/router';

function renderDemo(chat: (body: { messages: { content: string }[] }, headers: Headers) => Response, caller_auth = false) {
  const calls: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url, headers });
      if (url.includes('/v1/chat/completions')) return chat(JSON.parse(String(init?.body)), headers);
      if (url.includes('/v1/analyze')) {
        return new Response(JSON.stringify({ sanitized: '고객 [사람_1] 메일 [이메일_1]', route: 'external', spans: [], findings: { 사람: 1, 이메일: 1 } }), { status: 200 });
      }
      if (url.includes('/v1/industries')) return new Response(JSON.stringify([{ industry: 'cosmetics', entities: [], applies_to: null, test_cases: 1 }]), { status: 200 });
      if (url.includes('/v1/config')) return new Response(JSON.stringify({ provider: 'openai', mock: true, caller_auth }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
  const router = createMemoryRouter(routes, { initialEntries: ['/demo'] });
  render(
    <Providers client={makeQueryClient()}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return calls;
}

describe('사내 앱 시연', () => {
  it('shows what was typed, what the outside model received, and the restored answer', async () => {
    const user = userEvent.setup();
    const calls = renderDemo(() => new Response(JSON.stringify({ choices: [{ message: { content: '홍길동님께 드립니다' } }] }), { status: 200, headers: { 'X-Gateway-Redacted': '2', 'X-Gateway-Route': 'external' } }));
    await user.click(await screen.findByRole('button', { name: '화장품' }));
    await user.type(screen.getByLabelText('LLM에게 시킬 일'), '고객 홍길동 메일 kim@corp.co.kr');
    await user.click(screen.getByRole('button', { name: '보내기' }));

    const card = await screen.findByLabelText('주고받은 내용');
    expect(within(card).getByText('고객 홍길동 메일 kim@corp.co.kr')).toBeInTheDocument(); // ① typed
    expect(within(card).getByText('[사람_1]')).toBeInTheDocument(); // ② what left, placeholders marked
    expect(within(card).getByText('가린 항목 2개')).toBeInTheDocument();
    expect(within(card).getByText('홍길동님께 드립니다')).toBeInTheDocument(); // ③ restored answer
    expect(calls.find((c) => c.url.includes('/v1/chat/completions'))?.headers.get('X-Gateway-Industry')).toBe('cosmetics');
  });

  it('says nothing was sent when the gateway blocks it', async () => {
    const user = userEvent.setup();
    renderDemo(() => new Response(JSON.stringify({ error: { type: 'gateway_blocked', findings: { 시크릿: 1 } } }), { status: 403 }));
    await user.type(await screen.findByLabelText('LLM에게 시킬 일'), 'sk-abcdefghijklmnopqrstuvwxyz123456');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText(/차단됐어요\. 보내면 안 되는 정보\(시크릿\)/)).toBeInTheDocument();
    expect(screen.getByText('전송 안 됨')).toBeInTheDocument();
    expect(screen.getByText('받은 답이 없어요.')).toBeInTheDocument();
  });
});

describe('접속 키', () => {
  it('asks for a key only when the gateway wants one, and sends it as a Bearer token', async () => {
    const user = userEvent.setup();
    const calls = renderDemo(() => new Response(JSON.stringify({ choices: [{ message: { content: '답' } }] }), { status: 200 }), true);
    await user.type(await screen.findByPlaceholderText('gw_...'), 'gw_demo');
    await user.type(screen.getByLabelText('LLM에게 시킬 일'), '안녕');
    await user.click(screen.getByRole('button', { name: '보내기' }));
    await screen.findByLabelText('주고받은 내용');
    expect(calls.find((c) => c.url.includes('/v1/chat/completions'))?.headers.get('Authorization')).toBe('Bearer gw_demo');
  });

  it('shows no key box when the gateway is open, and explains a 401', async () => {
    const user = userEvent.setup();
    renderDemo(() => new Response(JSON.stringify({ error: { type: 'unauthorized' } }), { status: 401 }));
    await user.type(await screen.findByLabelText('LLM에게 시킬 일'), '안녕');
    expect(screen.queryByPlaceholderText('gw_...')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '보내기' }));
    expect(await screen.findByText(/접속 키가 없거나 맞지 않아요/)).toBeInTheDocument();
  });
});
