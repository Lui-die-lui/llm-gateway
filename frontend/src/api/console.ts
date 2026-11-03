// Console features. Pages call these like any other api. The company policy (custom rules, built-in switches) is real:
// it is stored and enforced by the gateway. Everything else still resolves against src/mocks (the gateway has no
// users, sessions, exceptions or settings yet); swapping one for a real endpoint means changing only that function's body.
import * as mock from '../mocks/db';
import { ApiError, request } from './client';
import { createReal, decideReal, realExceptions, realMine, revokeReal } from './exceptions';
import { gateway } from './gateway';
import type { Anomaly, ApiKeyItem, BasicRuleState, ServerSettings, SettingsValues, Decision, MinutePoint, PolicyRule, PolicyState, RuleDraft, Ttl } from './consoleTypes';

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
  exceptions: () => realExceptions(),
  decideException: (id: string, d: Decision, ttl: Ttl, memo: string) => decideReal(id, d, ttl, memo),
  revokeException: (id: string) => revokeReal(id),

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

  serverSettings: () => request<ServerSettings>('/v1/settings'),
  saveSettings: (patch: Partial<SettingsValues>) => request<ServerSettings>('/v1/settings', { method: 'PATCH', body: patch }),
  setSlack: (url: string) => request<ServerSettings>('/v1/settings/slack', { method: 'PUT', body: { url } }),
  slackTest: () => request<{ ok: boolean; message: string }>('/v1/settings/slack/test', { method: 'POST' }),
  createKey: (name: string) => request<{ key: string; item: ApiKeyItem }>('/v1/settings/keys', { method: 'POST', body: { name } }),
  revokeKey: (id: number) => request<{ ok: boolean }>(`/v1/settings/keys/${id}`, { method: 'DELETE' }),
};

export const portalApi = {
  requests: () => realMine(),
  createException: (input: { reason: string; scope: '1회' | '1시간' | '24시간'; requester: string; entity: string; site: string }) => createReal(input),
};
