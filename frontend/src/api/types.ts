// Shapes returned by the gateway (docs/API.md). Only metadata; no prompt text or original values ever.

export type Direction = 'request' | 'response';
export type Action = 'redact' | 'block' | 'internal_only';
export type AuditStatus = 'ok' | 'blocked' | 'response_blocked' | 'upstream_error';
export type Route = 'external' | 'internal' | 'block';

export interface Finding {
  direction: Direction;
  label: string;
  action: Action;
  count: number;
}

export interface StatsSummary {
  requests: number;
  by_status: Partial<Record<AuditStatus, number>>;
  by_route: Partial<Record<Route, number>>;
  by_industry: Record<string, number>;
  findings: Finding[];
  redacted_items: number;
  response_redacted_items: number;
}

export interface TimeseriesPoint {
  bucket: string; // ISO, UTC
  requests: number;
  blocked: number;
  redacted_items: number;
}

export interface AuditEvent {
  id: number;
  ts: number; // unix seconds
  endpoint: string;
  provider: string;
  route: Route | string;
  status: AuditStatus;
  industries: string;
  use_case: string | null;
  stream: number | boolean;
  latency_ms: number | null;
  findings: Finding[];
}

export interface AuditQuery {
  limit?: number;
  offset?: number;
  label?: string;
  status?: AuditStatus;
}

export interface IndustryEntity {
  id: string;
  label: string;
  sensitivity: string;
  action: Action;
  regulation: string | null;
}

export interface Industry {
  industry: string;
  entities: IndustryEntity[];
  applies_to: Record<string, unknown> | null;
  test_cases: number;
}

export interface EvalRow {
  industry: string;
  expected: number;
  generic_caught: number;
  template_caught: number;
  generic_recall: number | null;
  template_recall: number | null;
  negative_cases: number;
  template_false_positives: number;
}

export interface EvalReport {
  industries: EvalRow[];
  overall: { expected: number; generic_recall: number | null; template_recall: number | null };
}

export interface AnalyzeRequest {
  text: string;
  industries?: string[];
  use_case?: string | null;
  flow?: string | null;
}

export interface AnalyzeSpan {
  start: number; // Python code point index
  end: number;
  label: string;
  action: Action;
}

export interface AnalyzeResult {
  sanitized: string;
  route: Route;
  spans: AnalyzeSpan[];
  findings: Record<string, number>;
}

export interface GatewayConfig {
  provider: string;
  mock: boolean;
  internal_route: boolean;
  response_scan: boolean;
  local_llm_detector: boolean;
  streaming: boolean;
  admin_protected: boolean;
}
