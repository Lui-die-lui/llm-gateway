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
  summary: (since = 0) => request<StatsSummary>('/v1/stats/summary', { query: { since: Math.floor(since) } }),
  // tz_offset: minutes east of UTC, so day buckets start at local midnight (the gateway otherwise cuts at UTC midnight).
  timeseries: (bucket: 'minute' | 'hour' | 'day', since = 0) =>
    request<TimeseriesPoint[]>('/v1/stats/timeseries', {
      query: { bucket, since: Math.floor(since), tz_offset: -new Date().getTimezoneOffset() },
    }),
  auditEvents: (q: AuditQuery = {}) =>
    request<AuditEvent[]>('/v1/audit/events', {
      query: { limit: q.limit ?? 50, offset: q.offset ?? 0, label: q.label, status: q.status },
    }),
};
