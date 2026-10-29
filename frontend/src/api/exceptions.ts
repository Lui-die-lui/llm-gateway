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
}

const TTL_LABEL: Record<Ttl, string> = { '1x': '1회', '1h': '1시간', '24h': '24시간', '7d': '7일' };
const CLIENT_KEY = 'gw.clientId';

export const isReal = (id: string) => id.startsWith('REQ-');

/** A random id this browser keeps, so "my requests" shows only what was sent from here. It is not a login. */
export function clientId(): string {
  try {
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
  };
}

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
  };
}

// The lists fall back to empty (the mock rows still show) if the gateway cannot be reached; a 401 still sends the admin to the token screen.
export const realExceptions = () =>
  request<ServerException[]>('/v1/exceptions').then((l) => l.map(toException), () => [] as ExceptionRequest[]);

export const realMine = () =>
  request<ServerException[]>('/v1/exceptions/mine', { query: { client_id: clientId() } }).then((l) => l.map(toPortal), () => [] as PortalRequest[]);

export const decideReal = (id: string, decision: Decision, ttl: Ttl, memo: string) =>
  request<ServerException>(`/v1/exceptions/${id}/decide`, { method: 'POST', body: { decision, ttl, memo } }).then(toException);

export const createReal = (input: { reason: string; scope: '1회' | '1시간' | '24시간'; requester: string; entity: string; site: string }) =>
  request<ServerException>('/v1/exceptions', { method: 'POST', body: { ...input, client_id: clientId() } }).then(toPortal);
