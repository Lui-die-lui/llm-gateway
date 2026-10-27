// Console features the gateway does not serve yet. Pages call these like any other api; today they resolve
// against src/mocks. Swapping one for a real endpoint means changing only the body of that function.
import * as mock from '../mocks/db';
import { ApiError } from './client';
import type { Decision, MemberStatus, RuleDraft, Settings, Ttl } from './consoleTypes';

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

  policy: () => served(mock.getPolicy),
  toggleRule: (id: string) => served(() => mock.toggleRule(id)),
  saveRule: (id: string, d: RuleDraft) => served(() => mock.saveRule(id, d)),
  addRule: (d: RuleDraft) => served(() => mock.addRule(d)),
  applyPolicy: () => served(mock.applyPolicy),

  basicRules: (defaults: Record<string, boolean>) => served(() => mock.getBasicRules(defaults)),
  applyBasicRules: (next: Record<string, boolean>, changed: number) => served(() => mock.applyBasicRules(next, changed)),

  exceptions: () => served(mock.listExceptions),
  decideException: (id: string, d: Decision, ttl: Ttl, memo: string) => served(() => mock.decideException(id, d, ttl, memo)),
  requestMoreInfo: (id: string) => served(() => mock.requestMoreInfo(id)),

  adminLog: () => served(mock.listAdminLog),
  trainingCandidates: () => served(mock.listCandidates),
  sendSlack: (id: string) => served(() => mock.sendSlack(id)),
  anomalies: () => served(mock.listAnomalies),
  ackAnomaly: (id: string, action: 'ack' | 'primary') => served(() => mock.ackAnomaly(id, action)),
  minuteSeries: () => served(() => mock.minuteSeries()),
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
  requests: () => served(mock.portalRequests),
  createException: (input: { reason: string; scope: '1회' | '1시간' | '24시간' }) => served(() => mock.createException(input)),
  lastBlocked: () => served(mock.lastBlockedSend),
  history: () => served(mock.history),
  clearHistory: () => served(mock.clearHistory),
  aliases: () => served(mock.aliases),
};
