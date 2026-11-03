// Types for features the gateway does not have yet (console login, company, members, policy editing, exceptions,
// Slack, admin log, settings, user portal). They are served by src/mocks through src/api/console.ts.
// frontend/README.md "서버에 필요한 것" lists the endpoint each one needs.

export interface ConsoleUser {
  name: string;
  email: string;
  role: 'admin' | 'member';
  owner: boolean;
}

export type LoginResult =
  | { kind: 'ok'; user: ConsoleUser; lastLogin: string }
  | { kind: 'otp'; ticket: string; email: string }
  | { kind: 'wrong'; remaining: number }
  | { kind: 'locked'; until: string }
  | { kind: 'notadmin' };

export type OtpResult = { kind: 'ok'; user: ConsoleUser; lastLogin: string } | { kind: 'wrong' };

export interface Company {
  name: string;
  code: string;
  industry: string; // gateway industry id, e.g. "cosmetics"
  mailDomain: string;
  members: number;
  admins: number;
}

export type Decision = 'approved' | 'rejected';

export interface JoinRequest {
  id: string;
  name: string;
  email: string;
  dept: string;
  when: string;
  check: string;
  warn: boolean;
  decision?: Decision;
}

export type MemberStatus = 'active' | 'idle' | 'inactive';

export interface Member {
  id: string;
  name: string;
  email: string;
  dept: string;
  role: 'admin' | 'member';
  owner: boolean;
  status: MemberStatus;
  last: string;
}

export type RuleKind = 'builtin' | 'words' | 'pattern' | 'ai';
export type RuleAction = 'redact' | 'block' | 'log';

export interface RuleOptions {
  ask: boolean;
  exc: boolean;
  notify: boolean;
}

export interface PolicyRule {
  id: string;
  prio: number;
  name: string;
  kind: RuleKind;
  cond: string;
  action: RuleAction;
  scope: string[];
  hits: string;
  enabled: boolean;
  builtins: string[];
  words: string;
  pattern: string;
  ai: string;
  tag: string;
  options: RuleOptions;
  isNew?: boolean;
}

export type RuleDraft = Omit<PolicyRule, 'id' | 'prio' | 'hits' | 'cond' | 'isNew'>;

export interface PolicyState {
  version: number;
  rules: PolicyRule[];
  pending: { ruleId: string; note: string }[];
}

export interface BasicRuleState {
  version: number;
  applied: Record<string, boolean>;
}

export type ExceptionStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type Ttl = '1x' | '1h' | '24h' | '7d';

export interface ExceptionRequest {
  id: string;
  user: string;
  dept: string;
  title: string;
  sev: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  sla: string;
  slaUrgent: 0 | 1 | 2;
  entity: string;
  scope: string;
  rule: string;
  target: string;
  history: string;
  reason: string;
  alt: string;
  status: ExceptionStatus;
  ttl?: Ttl;
  memo?: string;
  requestedAt: string;
  /** Real requests only: when the admin decided (epoch seconds) and whether a one-use approval has been spent. */
  decidedAt?: number;
  used?: boolean;
  revoked?: boolean;
}

export interface AdminLogEntry {
  t: string;
  who: string;
  act: string;
  target: string;
  note: string;
  tone: 'clean' | 'accent' | 'redact' | 'block' | 'muted';
}

export interface TrainingCandidate {
  id: string;
  user: string;
  dept: string;
  why: string;
  n: number;
  sentAt?: string;
}

export interface Anomaly {
  id: string;
  sev: 'HIGH' | 'MEDIUM' | 'LOW';
  t: string;
  title: string;
  desc: string;
  primary: string;
  primaryHref?: string;
  acked: boolean;
}

export interface MinutePoint {
  t: string;
  total: number;
  redact: number;
  block: number;
}

export interface DeptHeatmap {
  cols: string[];
  rows: { dept: string; values: number[] }[];
}

export interface ReportSchedule {
  name: string;
  when: string;
  to: string;
  on: boolean;
}

/* ---- user portal ---- */

export interface PortalProfile {
  name: string;
  dept: string;
  extension: string;
  policyRev: number;
}

export interface PortalRecent {
  id: string;
  t: string;
  site: string;
  what: string;
  result: 'redact' | 'block' | 'clean' | 'file';
  flagged: boolean;
}

export interface PortalRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  title: string;
  note: string;
  when: string;
  scope: string;
  /** Only for requests the gateway really stores: how long an approval lasts, when it was decided, and whether a one-use one is spent. */
  ttl?: Ttl;
  decidedAt?: number;
  used?: boolean;
  revoked?: boolean;
}

export type ReplaceHow = 'ph' | 'alias' | 'keep';

export interface HistoryEntry {
  id: string;
  title: string;
  when: string;
  day: number;
  site: string;
  kind: string;
  icon: 'TXT' | 'FILE';
  /** masked = partially hidden original (홍*동); the full value never leaves the employee's device. */
  rows: { masked: string; type: string; to: string; how: ReplaceHow; result: string }[];
  wire: { t: string; how?: ReplaceHow }[];
}

export interface BlockedSend {
  when: string;
  site: string;
  summary: string;
}

/** An access key made in the console. The key itself is shown once, when it is made, and is not part of this. */
export interface ApiKeyItem {
  id: number;
  name: string;
  tail: string;
  created: number;
  revoked: boolean;
}
export interface SettingsValues {
  response_scan: boolean;
  vault_ttl_minutes: number;
  once_valid_hours: number;
  keep_decided_days: number;
  notify_new_exception: boolean;
}
export type NumericSetting = 'vault_ttl_minutes' | 'once_valid_hours' | 'keep_decided_days';
/** GET /v1/settings: what the admin can change, and the facts the server was started with. Never a key, token or address. */
export interface ServerSettings {
  values: SettingsValues;
  limits: Record<NumericSetting, { min: number; max: number }>;
  slack: { configured: boolean; host: string | null; source: 'env' | 'console' | null; console_link: boolean };
  keys: { env_keys: number; required: boolean; list: ApiKeyItem[] };
  data: { audit_events: number; exception_requests: number };
  log: { t: number; what: string; detail: string }[];
  environment: { provider: string; mock: boolean; admin_protected: boolean; max_text: number; cors_origins: string[]; stores_prompt_text: boolean };
}
