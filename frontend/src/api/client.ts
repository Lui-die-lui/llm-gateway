// One fetch wrapper for every gateway call: base URL, optional admin token, and the shared error shape.

const TOKEN_KEY = 'gw.adminToken';

/** Dev goes through the Vite proxy (/gw), which can attach GATEWAY_ADMIN_TOKEN server-side. */
export const GATEWAY_URL: string = import.meta.env.DEV
  ? '/gw'
  : ((import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? 'http://localhost:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const adminToken = {
  get(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(value: string): void {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage blocked: the token simply is not remembered */
    }
  },
};

type Listener = (err: ApiError) => void;
const unauthorizedListeners = new Set<Listener>();

/** Called on every 401 so the app can send the user to the token screen. */
export function onUnauthorized(fn: Listener): () => void {
  unauthorizedListeners.add(fn);
  return () => unauthorizedListeners.delete(fn);
}

/**
 * Normalises `{"error": {"type", ...}}` (gateway errors) and FastAPI's `{"detail": ...}` (raised HTTPException,
 * which is what the admin-token check returns) into one ApiError.
 */
export function toApiError(status: number, body: unknown): ApiError {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.error && typeof b.error === 'object') {
      const e = b.error as Record<string, unknown>;
      const type = typeof e.type === 'string' ? e.type : 'error';
      const msg = typeof e.message === 'string' ? e.message : type;
      return new ApiError(status, type, msg, body);
    }
    if (typeof b.detail === 'string') {
      return new ApiError(status, status === 401 ? 'unauthorized' : 'http_error', b.detail, body);
    }
  }
  return new ApiError(status, status === 401 ? 'unauthorized' : 'http_error', `HTTP ${status}`, body);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${GATEWAY_URL}${path}${qs.size ? `?${qs}` : ''}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = adminToken.get();
  if (token) headers['X-Admin-Token'] = token;

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', '검사 서버에 연결하지 못했어요');
  }

  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const err = toApiError(res.status, data);
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn(err));
    throw err;
  }
  return data as T;
}

/** Human-readable Korean message for an error from any api function. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.type) {
      case 'network_error':
        return '검사 서버에 연결하지 못했어요 · 서버가 켜져 있는지 확인하세요';
      case 'unauthorized':
        return '관리자 토큰이 필요해요';
      case 'unknown_industry':
        return `없는 업종 이름이에요 (${err.message})`;
      case 'invalid_request':
        return `요청 형식이 맞지 않아요 (${err.message})`;
      case 'gateway_blocked':
        return '차단 대상이 있어 처리하지 않았어요';
      case 'upstream_error':
        return '외부 LLM 호출이 실패했어요';
      default:
        return err.message || `오류 (${err.status})`;
    }
  }
  return err instanceof Error ? err.message : '알 수 없는 오류';
}
