// Console features. Pages call these like any other api. The company policy (custom rules, built-in switches) is real:
// it is stored and enforced by the gateway. Everything else still resolves against src/mocks (the gateway has no
// users, sessions, exceptions or settings yet); swapping one for a real endpoint means changing only that function's body.
import * as mock from '../mocks/db';
import { ApiError, request } from './client';
import { createReal, decideReal, isReal, realExceptions, realMine, revokeReal } from './exceptions';
import { gateway } from './gateway';
import type { Anomaly, BasicRuleState, Decision, MinutePoint, MemberStatus, PolicyRule, PolicyState, RuleDraft, Settings, Ttl } from './consoleTypes';

/** The gateway's policy view, with the "new" flag the editor shows for rules that exist only in the draft. */
interface ServerPolicy extends Omit<PolicyState, 'rules'> {
  rules: PolicyRule[];
}
const withNewFlag = (p: ServerPolicy): PolicyState => ({
  ...p,
  rules: p.rules.map((r) => ({ ...r, isNew: p.pending.some((x) => x.ruleId === r.id && x.note.endsWith('규칙 새로 만듦')) })),
});

const LATENCY = import.meta.env.MODE === 'test' ? 0 : 160;

function served<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(new ApiError(400, 'mock_error', (e as Error).message));
      }
    }, LATENCY);
  });
}

export const consoleApi = {
  login: (email: string, password: string) => served(() => mock.login(email, password)),
  verifyOtp: (ticket: string, code: string) => served(() => mock.verifyOtp(ticket, code)),

  company: () => served(mock.getCompany),
  joinRequests: () => served(mock.listJoinRequests),
  decideJoin: (id: string, d: Decision) => served(() => mock.decideJoin(id, d)),
  members: () => served(mock.listMembers),
  setMemberRole: (id: string, role: 'admin' | 'member') => served(() => mock.setMemberRole(id, role)),
  setMemberStatus: (id: string, s: MemberStatus) => served(() => mock.setMemberStatus(id, s)),
  regenerateCode: () => served(mock.regenerateCode),

  policy: () => request<ServerPolicy>('/v1/policy').then(withNewFlag),
  toggleRule: (id: string) => request<ServerPolicy>(`/v1/policy/rules/${id}/toggle`, { method: 'POST' }).then(withNewFlag),
  saveRule: (id: string, d: RuleDraft) => request<ServerPolicy>(`/v1/policy/rules/${id}`, { method: 'PUT', body: d }).then(withNewFlag),
  addRule: (d: RuleDraft) =>
    request<{ policy: ServerPolicy; id: string }>('/v1/policy/rules', { method: 'POST', body: d }).then((r) => ({ policy: withNewFlag(r.policy), id: r.id })),
  deleteRule: (id: string) => request<ServerPolicy>(`/v1/policy/rules/${id}`, { method: 'DELETE' }).then(withNewFlag),
  applyPolicy: () => request<{ version: number; applied: number }>('/v1/policy/apply', { method: 'POST' }),

  /** `defaults` fills in rules the gateway has no stored switch for yet (they are on). */
  basicRules: (defaults: Record<string, boolean>) =>
    request<BasicRuleState>('/v1/policy/builtin').then((s) => ({ version: s.version, applied: { ...defaults, ...s.applied } })),
  applyBasicRules: (next: Record<string, boolean>) =>
    request<BasicRuleState>('/v1/policy/builtin', { method: 'PUT', body: { enabled: next } }),

  // Requests really sent to the gateway (REQ-) come first, then the mock seed (EXC-).
  exceptions: () => Promise.all([realExceptions(), served(mock.listExceptions)]).then(([real, seed]) => [...real, ...seed]),
  decideException: (id: string, d: Decision, ttl: Ttl, memo: string) =>
    isReal(id) ? decideReal(id, d, ttl, memo) : served(() => mock.decideException(id, d, ttl, memo)),
  revokeException: (id: string) => revokeReal(id),
  requestMoreInfo: (id: string) => served(() => mock.requestMoreInfo(id)),

  adminLog: () => served(mock.listAdminLog),
  trainingCandidates: () => served(mock.listCandidates),
  sendSlack: (id: string) => served(() => mock.sendSlack(id)),
  /** Real: computed by the gateway from its audit log. */
  anomalies: (): Promise<Anomaly[]> =>
    gateway.anomalies().then((l) => l.map((a) => ({ id: a.id, sev: a.sev, t: a.t, title: a.title, desc: a.desc, primary: a.primary, primaryHref: a.primary_href, acked: a.acked }))),
  ackAnomaly: (id: string) => gateway.ackAnomaly(id),
  /** Real: the gateway's per-minute buckets for the last 60 minutes (empty minutes are 0). */
  minuteSeries: async (): Promise<MinutePoint[]> => {
    const nowMin = Math.floor(Date.now() / 60_000);
    const pts = await gateway.timeseries('minute', (nowMin - 59) * 60);
    const byMinute = new Map(pts.map((p) => [Math.floor(new Date(p.bucket).getTime() / 60_000), p]));
    return Array.from({ length: 60 }, (_, i) => {
      const k = nowMin - 59 + i;
      const d = new Date(k * 60_000);
      const p = byMinute.get(k);
      return { t: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, total: p?.requests ?? 0, redact: p?.redacted_requests ?? 0, block: p?.blocked ?? 0 };
    });
  },
  deptHeatmap: () => served(mock.deptHeatmap),
  schedules: () => served(mock.schedules),

  settings: () => served(mock.getSettings),
  saveSettings: (s: Settings) => served(() => mock.saveSettings(s)),
  pauseProtection: () => served(mock.pauseProtection),
  scheduleCompanyDelete: () => served(mock.scheduleCompanyDelete),
};

export const portalApi = {
  profile: () => served(mock.portalProfile),
  recent: () => served(mock.portalRecent),
  flagRecent: (id: string) => served(() => mock.flagRecent(id)),
  requests: () => Promise.all([realMine(), served(mock.portalRequests)]).then(([real, seed]) => [...real, ...seed]),
  createException: (input: { reason: string; scope: '1회' | '1시간' | '24시간'; requester: string; entity: string; site: string }) => createReal(input),
  lastBlocked: () => served(mock.lastBlockedSend),
  history: () => served(mock.history),
  clearHistory: () => served(mock.clearHistory),
  aliases: () => served(mock.aliases),
};
