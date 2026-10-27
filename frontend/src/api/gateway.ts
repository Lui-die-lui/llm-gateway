// Real gateway endpoints (docs/API.md). Everything here hits the server.
import { request } from './client';
import type {
  AnalyzeRequest,
  AnalyzeResult,
  AuditEvent,
  AuditQuery,
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
  evalReport: () => request<EvalReport>('/v1/eval'),
  analyze: (body: AnalyzeRequest) => request<AnalyzeResult>('/v1/analyze', { method: 'POST', body }),
  summary: (since = 0) => request<StatsSummary>('/v1/stats/summary', { query: { since: Math.floor(since) } }),
  timeseries: (bucket: 'hour' | 'day', since = 0) =>
    request<TimeseriesPoint[]>('/v1/stats/timeseries', { query: { bucket, since: Math.floor(since) } }),
  auditEvents: (q: AuditQuery = {}) =>
    request<AuditEvent[]>('/v1/audit/events', {
      query: { limit: q.limit ?? 50, offset: q.offset ?? 0, label: q.label, status: q.status },
    }),
};
