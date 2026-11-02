// Exception requests the gateway really stores (/v1/exceptions), shaped like the mock ones so the pages show both in one list.
// Real ids start with REQ-; the mock seed uses EXC-. A real request is submitted from the portal (any computer) and decided in the console.
import { request } from './client';
import type { Decision, ExceptionRequest, PortalRequest, Ttl } from './consoleTypes';

interface ServerException {
  id: string;
  created: number;
  requester: string;
  entity: string;
  site: string;
  reason: string;
  scope: '1회' | '1시간' | '24시간';
  status: 'pending' | 'approved' | 'rejected';
  ttl: Ttl | null;
  memo: string;
  decided: number | null;
  used: boolean;
  revoked: boolean;
}

const TTL_LABEL: Record<Ttl, string> = { '1x': '1회', '1h': '1시간', '24h': '24시간', '7d': '7일' };
const CLIENT_KEY = 'gw.clientId';

export const isReal = (id: string) => id.startsWith('REQ-');

const ID_SHAPE = /^b-[A-Za-z0-9]{8,64}$/;

/**
 * A random id this browser keeps, so "my requests" shows only what was sent from here. It is not a login.
 * The extension opens the portal with ?cid=<its own id>: that one wins and is remembered, so the request form and the chat page
 * (which shows the answer, with the time it lasts) talk about the same person.
 */
export function clientId(): string {
  try {
    const fromLink = new URLSearchParams(location.search).get('cid');
    if (fromLink && ID_SHAPE.test(fromLink)) {
      localStorage.setItem(CLIENT_KEY, fromLink);
      return fromLink;
    }
    const have = localStorage.getItem(CLIENT_KEY);
    if (have) return have;
    const made = `b-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '')}`;
    localStorage.setItem(CLIENT_KEY, made);
    return made;
  } catch {
    return 'b-unsaved';
  }
}

function when(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  return d.toDateString() === now.toDateString() ? `오늘 ${hm}` : `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

function toException(s: ServerException): ExceptionRequest {
  return {
    id: s.id,
    user: s.requester,
    dept: '직접 접수',
    title: s.entity ? `${s.entity} 원문 전송 요청` : '원문 전송 요청',
    sev: 'HIGH',
    sla: '대기 중',
    slaUrgent: 0,
    entity: s.entity || '항목 미지정',
    scope: s.scope,
    rule: '—',
    target: s.site || '브라우저 확장',
    history: '게이트웨이에 실제로 접수된 요청',
    reason: s.reason,
    alt: '외부 전송 없이 내부 모델로 처리할 수 있는지, 가린 채로 보내도 되는지 먼저 확인하세요.',
    status: s.status,
    ttl: s.ttl ?? undefined,
    memo: s.memo || undefined,
    requestedAt: when(s.created),
    decidedAt: s.decided ?? undefined,
    used: s.used,
    revoked: s.revoked,
  };
}

const TTL_SECONDS: Partial<Record<Ttl, number>> = { '1h': 3600, '24h': 86400, '7d': 604800 };
// A one-use approval nobody used lapses after a day (same number as ONCE_VALID_SECONDS on the server).
const ONCE_SECONDS = 86400;

/** When an approval stops (epoch seconds). A one-use approval that is still unused stops a day after it was given. */
export const grantEnd = (e: ExceptionRequest): number | null => {
  const secs = e.ttl === '1x' ? ONCE_SECONDS : e.ttl ? TTL_SECONDS[e.ttl] : undefined;
  return secs && e.decidedAt ? e.decidedAt + secs : null;
};

/** A real approval that still lets something through: approved, not taken back, not over, a one-use one not yet spent. */
export const isActiveGrant = (e: ExceptionRequest, nowSeconds: number) => {
  if (!isReal(e.id) || e.status !== 'approved' || e.used || e.revoked) return false;
  const end = grantEnd(e);
  return end === null || end > nowSeconds;
};

function toPortal(s: ServerException): PortalRequest {
  const note =
    s.status === 'pending'
      ? '보안관리자 결정 대기 중이에요.'
      : s.status === 'approved'
        ? s.memo || `${TTL_LABEL[s.ttl ?? '1x']} 허용됐어요.`
        : s.memo || '반려됐어요.';
  return {
    id: s.id,
    status: s.status === 'pending' ? 'PENDING' : s.status === 'approved' ? 'APPROVED' : 'REJECTED',
    title: s.entity ? `${s.entity} 원문 전송` : '원문 전송 요청',
    note,
    when: when(s.created),
    scope: `${s.site || '브라우저'} · ${s.scope}`,
    ttl: s.ttl ?? undefined,
    decidedAt: s.decided ?? undefined,
    used: s.used,
  };
}

export type GrantTime =
  | { kind: 'running'; remainingSeconds: number; endsAt: number }
  | { kind: 'once-open' }
  | { kind: 'once-used' }
  | { kind: 'ended' };

/** What an approved request lets the person do right now. null: not an approved, real request, so nothing to show. */
export function grantTime(p: PortalRequest, nowSeconds: number): GrantTime | null {
  if (p.status !== 'APPROVED' || !isReal(p.id)) return null;
  if (p.revoked) return { kind: 'ended' };
  const secs = p.ttl ? TTL_SECONDS[p.ttl] : undefined;
  if (!secs) {
    if (p.used) return { kind: 'once-used' };
    return p.decidedAt != null && p.decidedAt + ONCE_SECONDS <= nowSeconds ? { kind: 'ended' } : { kind: 'once-open' };
  }
  if (p.decidedAt == null) return null;
  const endsAt = p.decidedAt + secs;
  return endsAt > nowSeconds ? { kind: 'running', remainingSeconds: endsAt - nowSeconds, endsAt } : { kind: 'ended' };
}

/** 3725 -> "1시간 2분", 90 -> "1분 30초" (seconds only under a minute-and-a-half is noise, so >= 10 minutes drops them). */
export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}일 ${h}시간`;
  if (h) return `${h}시간 ${m}분`;
  if (m >= 10) return `${m}분`;
  if (m) return `${m}분 ${s % 60}초`;
  return `${s}초`;
}

// The lists fall back to empty (the mock rows still show) if the gateway cannot be reached; a 401 still sends the admin to the token screen.
export const realExceptions = () =>
  request<ServerException[]>('/v1/exceptions').then((l) => l.map(toException), () => [] as ExceptionRequest[]);

export const realMine = () =>
  request<ServerException[]>('/v1/exceptions/mine', { query: { client_id: clientId() } }).then((l) => l.map(toPortal), () => [] as PortalRequest[]);

export const decideReal = (id: string, decision: Decision, ttl: Ttl, memo: string) =>
  request<ServerException>(`/v1/exceptions/${id}/decide`, { method: 'POST', body: { decision, ttl, memo } }).then(toException);

export const revokeReal = (id: string) => request<ServerException>(`/v1/exceptions/${id}/revoke`, { method: 'POST' }).then(toException);

export const createReal = (input: { reason: string; scope: '1회' | '1시간' | '24시간'; requester: string; entity: string; site: string }) =>
  request<ServerException>('/v1/exceptions', { method: 'POST', body: { ...input, client_id: clientId() } }).then(toPortal);
