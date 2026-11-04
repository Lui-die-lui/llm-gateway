// Real gateway endpoints (docs/API.md). Everything here hits the server.
import { request } from './client';
import type {
  AnalyzeRequest,
  AnalyzeResult,
  AuditEvent,
  AuditQuery,
  BuiltinGroup,
  EvalReport,
  GatewayConfig,
  Industry,
  ServerAnomaly,
  StatsSummary,
  TimeseriesPoint,
} from './types';

export const gateway = {
  health: () => request<{ status: string }>('/health'),
  config: () => request<GatewayConfig>('/v1/config'),
  industries: () => request<Industry[]>('/v1/industries'),
  builtinRules: () => request<{ groups: BuiltinGroup[] }>('/v1/rules/builtin').then((r) => r.groups),
  evalReport: () => request<EvalReport>('/v1/eval'),
  analyze: (body: AnalyzeRequest) => request<AnalyzeResult>('/v1/analyze', { method: 'POST', body }),
  /** The period is [since, until). Leave `until` out for "up to now". */
  summary: (since = 0, until?: number) => request<StatsSummary>('/v1/stats/summary', { query: { since: Math.floor(since), until: until === undefined ? undefined : Math.floor(until) } }),
  // tz_offset: minutes east of UTC, so day buckets start at local midnight (the gateway otherwise cuts at UTC midnight).
  timeseries: (bucket: 'minute' | 'hour' | 'day', since = 0) =>
    request<TimeseriesPoint[]>('/v1/stats/timeseries', {
      query: { bucket, since: Math.floor(since), tz_offset: -new Date().getTimezoneOffset() },
    }),
  anomalies: () => request<ServerAnomaly[]>('/v1/anomalies'),
  ackAnomaly: (id: string) => request<{ ok: boolean }>('/v1/anomalies/ack', { method: 'POST', body: { id } }),
  /** Admin only, no undo: empties what the gateway stored (used before a demo). */
  clearAudit: () => request<{ deleted: number }>('/v1/audit/events', { method: 'DELETE' }),
  /** Public: the departments the join form offers. */
  departments: () => request<{ departments: string[] }>('/v1/members/departments'),
  clearMembers: () => request<{ deleted: number }>('/v1/members', { method: 'DELETE' }),
  /** Public: a person asks to join; the admin decides in the console. */
  joinMember: (body: { name: string; email: string; dept: string }) => request<{ id: string; status: string }>('/v1/members/join', { method: 'POST', body }),
  clearExceptions: () => request<{ deleted: number }>('/v1/exceptions', { method: 'DELETE' }),
  auditEvents: (q: AuditQuery = {}) =>
    request<AuditEvent[]>('/v1/audit/events', {
      query: { limit: q.limit ?? 50, offset: q.offset ?? 0, label: q.label, status: q.status, site: q.site, dept: q.dept, since: q.since === undefined ? undefined : Math.floor(q.since), exception: q.exception === undefined ? undefined : String(q.exception) },
    }),
};
