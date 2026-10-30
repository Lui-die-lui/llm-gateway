import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminToken, ApiError, onUnauthorized, request, toApiError } from '../api/client';
import { clientId } from '../api/exceptions';

afterEach(() => vi.unstubAllGlobals());

describe('toApiError', () => {
  it('reads the gateway error shape', () => {
    const e = toApiError(403, { error: { type: 'gateway_blocked', direction: 'request', findings: { 시크릿: 1 } } });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.type).toBe('gateway_blocked');
    expect(e.status).toBe(403);
  });
  it("reads FastAPI's detail shape (admin token check)", () => {
    const e = toApiError(401, { detail: 'admin token required (X-Admin-Token)' });
    expect(e.type).toBe('unauthorized');
  });
});

describe('request', () => {
  it('sends the session token and notifies on 401', async () => {
    adminToken.set('tok-example');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'admin token required' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const seen: ApiError[] = [];
    const off = onUnauthorized((e) => seen.push(e));
    await expect(request('/v1/stats/summary', { query: { since: 0 } })).rejects.toMatchObject({ status: 401 });
    off();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/gw/v1/stats/summary?since=0');
    expect((init.headers as Record<string, string>)['X-Admin-Token']).toBe('tok-example');
    expect(seen).toHaveLength(1);
  });

  it('turns a failed fetch into network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(request('/health')).rejects.toMatchObject({ type: 'network_error' });
  });
});


describe('clientId', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('keeps one random id for this browser', () => {
    const a = clientId();
    expect(a).toMatch(/^b-[a-z0-9]+$/);
    expect(clientId()).toBe(a);
  });

  it("takes the extension's id from ?cid= and remembers it, so both talk about the same person", () => {
    const own = clientId();
    window.history.replaceState({}, '', '/me/request?cid=b-0123456789abcdef0123456789abcdef&labels=조성비');
    expect(clientId()).toBe('b-0123456789abcdef0123456789abcdef');
    window.history.replaceState({}, '', '/me');
    expect(clientId()).toBe('b-0123456789abcdef0123456789abcdef'); // still the extension's id after navigating away
    expect(clientId()).not.toBe(own);
  });

  it('ignores a ?cid= that is not shaped like an id', () => {
    const own = clientId();
    window.history.replaceState({}, '', '/me?cid=<script>alert(1)</script>');
    expect(clientId()).toBe(own);
  });
});
