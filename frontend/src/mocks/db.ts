// In-memory mock server for features the gateway does not have yet. src/api/console.ts is the only caller.
// State lives for the page session; settings are kept in localStorage so 2FA / idle timeout survive a reload.
import type {
  AdminLogEntry,
  BasicRuleState,
  ConsoleUser,
  Decision,
  ExceptionRequest,
  LoginResult,
  MemberStatus,
  OtpResult,
  PolicyRule,
  PolicyState,
  PortalRequest,
  RuleDraft,
  Settings,
  Ttl,
} from '../api/consoleTypes';
import * as seed from './seed';

const SETTINGS_KEY = 'gw.mock.settings';
const MOCK_PASSWORD = 'test1234';
const ADMIN_EMAIL = 'admin@example.com';
const MAX_FAILS = 5;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...seed.settings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return seed.settings();
}

function fresh() {
  return {
    company: seed.company(),
    settings: loadSettings(),
    joins: seed.joinRequests(),
    members: seed.members(),
    rules: seed.policyRules(),
    pending: seed.policyPending(),
    policyVersion: 14,
    basic: { version: 3, applied: {} as Record<string, boolean>, initialized: false },
    exceptions: seed.exceptions(),
    adminLog: seed.adminLog(),
    candidates: seed.trainingCandidates(),
    anomalies: seed.anomalies(),
    portalRecent: seed.portalRecent(),
    portalRequests: seed.portalRequests(),
    history: seed.history(),
    historyCleared: false,
    fails: {} as Record<string, number>,
    otpTickets: {} as Record<string, string>,
    nextExc: 143,
    nextRule: 100,
  };
}

let db = fresh();

/** Tests call this between cases. */
export function resetMockDb(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    /* ignore */
  }
  db = fresh();
}

const clone = <T>(v: T): T => structuredClone(v);

function nowHm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function log(act: string, target: string, note: string, tone: AdminLogEntry['tone'], who = '보안관리자'): void {
  db.adminLog.unshift({ t: nowHm(), who, act, target, note, tone });
}

const adminUser = (): ConsoleUser => ({ name: '보안관리자', email: ADMIN_EMAIL, role: 'admin', owner: true });

/* ---------------- auth ---------------- */

export function login(email: string, password: string): LoginResult {
  const id = email.trim().toLowerCase();
  const fails = db.fails[id] ?? 0;
  if (db.settings.lockout && fails >= MAX_FAILS) return { kind: 'locked', until: '15분 뒤' };
  if (id === ADMIN_EMAIL && password === MOCK_PASSWORD) {
    db.fails[id] = 0;
    if (db.settings.twoFactor) {
      const ticket = Math.random().toString(36).slice(2);
      db.otpTickets[ticket] = id;
      return { kind: 'otp', ticket, email: id };
    }
    return { kind: 'ok', user: adminUser(), lastLogin: '어제 18:12 · 같은 기기' };
  }
  if (id.endsWith('@example.com') && password === MOCK_PASSWORD) return { kind: 'notadmin' };
  db.fails[id] = fails + 1;
  if (db.settings.lockout && fails + 1 >= MAX_FAILS) {
    log('로그인 실패 잠금', id, `비밀번호 ${MAX_FAILS}회 틀림 · 15분 잠김`, 'block', '시스템');
    return { kind: 'locked', until: '15분 뒤' };
  }
  return { kind: 'wrong', remaining: db.settings.lockout ? MAX_FAILS - fails - 1 : 99 };
}

export function verifyOtp(ticket: string, code: string): OtpResult {
  if (!db.otpTickets[ticket] || !/^\d{6}$/.test(code) || code === '000000') return { kind: 'wrong' };
  delete db.otpTickets[ticket];
  return { kind: 'ok', user: adminUser(), lastLogin: '어제 18:12 · 같은 기기' };
}

/* ---------------- company / members ---------------- */

export const getCompany = () => clone({ ...db.company, name: db.settings.companyName });
export const listJoinRequests = () => clone(db.joins);
export const listMembers = () => clone(db.members);

export function decideJoin(id: string, decision: Decision) {
  const r = db.joins.find((j) => j.id === id);
  if (!r) throw new Error('없는 가입 요청이에요');
  r.decision = decision;
  if (decision === 'approved') {
    db.company.members += 1;
    log('가입 승인', `${r.name} · ${r.dept}`, r.warn ? '경고 확인 후 승인' : '회사 메일 확인 후 승인', 'clean');
  } else {
    log('가입 거절', r.email, r.warn ? '회사 메일 아님 · 사유 전달' : '사유 전달', 'block');
  }
  return clone(r);
}

export function setMemberRole(id: string, role: 'admin' | 'member') {
  const m = db.members.find((x) => x.id === id);
  if (!m) throw new Error('없는 구성원이에요');
  if (m.owner) throw new Error('소유자 역할은 바꿀 수 없어요');
  if (m.role === 'admin' && role === 'member' && db.members.filter((x) => x.role === 'admin').length <= 1) {
    throw new Error('마지막 관리자는 뺄 수 없어요');
  }
  m.role = role;
  log('역할 변경', m.name, role === 'admin' ? '직원 → 보안 관리자' : '보안 관리자 → 직원', 'accent');
  return clone(m);
}

export function setMemberStatus(id: string, status: MemberStatus) {
  const m = db.members.find((x) => x.id === id);
  if (!m) throw new Error('없는 구성원이에요');
  if (m.owner && status === 'inactive') throw new Error('소유자는 비활성화할 수 없어요');
  m.status = status;
  log(status === 'inactive' ? '구성원 비활성화' : '구성원 다시 켜기', m.name, status === 'inactive' ? '로그인 막힘 · 기록은 남음' : '다시 사용 가능', 'muted');
  return clone(m);
}

export function regenerateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  const prev = db.company.code;
  db.company.code = `HANBIT-${s}`;
  log('회사 코드', db.company.code, `새 코드 발급 · 이전 코드(${prev}) 중지`, 'muted');
  return db.company.code;
}

/* ---------------- policy (custom rules) ---------------- */

export function getPolicy(): PolicyState {
  return clone({ version: db.policyVersion, rules: db.rules, pending: db.pending });
}

function markPending(ruleId: string, note: string) {
  const existing = db.pending.find((p) => p.ruleId === ruleId);
  if (existing) existing.note = note;
  else db.pending.push({ ruleId, note });
}

const KIND_LABEL: Record<PolicyRule['kind'], string> = {
  builtin: '기본 정보',
  words: '회사 단어 목록',
  pattern: '모양 (패턴)',
  ai: '설명 (AI)',
};

function condOf(d: RuleDraft): string {
  if (d.kind === 'builtin') return d.builtins.join(', ') || '고른 항목 없음';
  if (d.kind === 'words') {
    const n = d.words.split('\n').filter((w) => w.trim()).length;
    return `회사 단어 목록 ${n}개`;
  }
  if (d.kind === 'pattern') return d.pattern ? `${d.pattern} 모양` : '모양 (패턴)';
  return d.ai ? `"${d.ai}"` : '설명 (AI)';
}

export function toggleRule(id: string) {
  const r = db.rules.find((x) => x.id === id);
  if (!r) throw new Error('없는 규칙이에요');
  r.enabled = !r.enabled;
  markPending(id, `${r.name} ${r.enabled ? '켜기' : '끄기'}`);
  return getPolicy();
}

export function saveRule(id: string, draft: RuleDraft) {
  const r = db.rules.find((x) => x.id === id);
  if (!r) throw new Error('없는 규칙이에요');
  Object.assign(r, draft, { cond: condOf(draft) });
  markPending(id, `${r.name} 수정`);
  return getPolicy();
}

export function addRule(draft: RuleDraft) {
  if (!draft.name.trim()) throw new Error('규칙명을 먼저 적어 주세요');
  const last = db.rules[db.rules.length - 1];
  const id = `r${db.nextRule++}`;
  db.rules.push({ ...draft, name: draft.name.trim(), id, prio: (last?.prio ?? 0) + 10, hits: '—', cond: `${KIND_LABEL[draft.kind]}로 찾음`, isNew: true });
  markPending(id, `${draft.name.trim()} 규칙 새로 만듦`);
  return { policy: getPolicy(), id };
}

export function applyPolicy() {
  if (!db.pending.length) throw new Error('적용할 변경이 없어요');
  const n = db.pending.length;
  db.policyVersion += 1;
  log('규칙 적용', `버전 ${db.policyVersion}`, db.pending.map((p) => p.note).join(' · '), 'accent');
  db.pending = [];
  db.rules.forEach((r) => delete r.isNew);
  return { version: db.policyVersion, applied: n };
}

/* ---------------- basic rules (policy 2) ---------------- */

export function getBasicRules(defaults: Record<string, boolean>): BasicRuleState {
  if (!db.basic.initialized) {
    db.basic.applied = { ...defaults };
    db.basic.initialized = true;
  }
  // rules that appeared later (e.g. a new industry template) start from their default
  for (const [k, v] of Object.entries(defaults)) if (!(k in db.basic.applied)) db.basic.applied[k] = v;
  return clone({ version: db.basic.version, applied: db.basic.applied });
}

export function applyBasicRules(next: Record<string, boolean>, changed: number) {
  db.basic.applied = { ...next };
  db.basic.version += 1;
  log('기본 규칙 적용', `기본 규칙 버전 ${db.basic.version}`, `${changed}건 켜기·끄기`, 'accent');
  return clone({ version: db.basic.version, applied: db.basic.applied });
}

/* ---------------- exceptions ---------------- */

export const listExceptions = () => clone(db.exceptions);

const TTL_LABEL: Record<Ttl, string> = { '1x': '1회', '1h': '1시간', '24h': '24시간', '7d': '7일' };

export function decideException(id: string, decision: Decision, ttl: Ttl, memo: string) {
  const e = db.exceptions.find((x) => x.id === id);
  if (!e) throw new Error('없는 예외 요청이에요');
  if (e.status !== 'pending') throw new Error('이미 처리한 요청이에요');
  e.status = decision;
  e.ttl = ttl;
  e.memo = memo;
  const pr = db.portalRequests.find((p) => p.id === id);
  if (pr) {
    pr.status = decision === 'approved' ? 'APPROVED' : 'REJECTED';
    pr.note = memo || (decision === 'approved' ? `${TTL_LABEL[ttl]} 허용됐어요.` : '반려됐어요.');
  }
  if (decision === 'approved') log('예외 승인', `${e.user} · ${e.entity}`, `${TTL_LABEL[ttl]} 원문 전송 허용`, 'redact');
  else log('예외 반려', `${e.user} · ${e.entity}`, memo || '반려 사유 전달', 'block');
  return clone(e);
}

export function requestMoreInfo(id: string) {
  const e = db.exceptions.find((x) => x.id === id);
  if (!e) throw new Error('없는 예외 요청이에요');
  log('정보 추가 요청', `${e.user} · ${e.id}`, '요청자에게 추가 설명 요청', 'muted');
}

/* ---------------- admin log / training / live ---------------- */

export const listAdminLog = () => clone(db.adminLog);
export const listCandidates = () => clone(db.candidates);

export function sendSlack(id: string) {
  if (!db.settings.slackConnected) throw new Error('Slack이 연결돼 있지 않아요 · 설정 › Slack 연동');
  const c = db.candidates.find((x) => x.id === id);
  if (!c) throw new Error('없는 후보예요');
  c.sentAt = `방금 · ${nowHm()}`;
  log('Slack 발송', c.user, `교육 안내 메시지 · ${c.why}`, 'muted');
  return clone(c);
}

export const listAnomalies = () => clone(db.anomalies);

export function ackAnomaly(id: string, action: 'ack' | 'primary') {
  const a = db.anomalies.find((x) => x.id === id);
  if (!a) throw new Error('없는 이상 징후예요');
  if (action === 'ack') a.acked = true;
  else log(a.primary, a.title, '이상 징후에서 실행', 'block');
  return clone(a);
}

/** Per-minute send counts for the last 60 minutes (the gateway only buckets by hour/day). */
export function minuteSeries(now = new Date()) {
  const out = [];
  const base = Math.floor(now.getTime() / 60000);
  for (let i = 0; i < 60; i++) {
    const k = base - 59 + i;
    const total = 210 + 30 * Math.sin(k / 6) + 14 * Math.sin(k * 1.7);
    const d = new Date(k * 60000);
    out.push({
      t: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
      total: Math.round(total),
      redact: Math.max(0, Math.round(total * 0.13 + 6 * Math.sin(k / 3))),
      block: i === 38 ? 34 : i === 39 ? 22 : Math.max(0, Math.round(3 + 2 * Math.sin(k))),
    });
  }
  return out;
}

export const deptHeatmap = () => seed.deptHeatmap();
export const schedules = () => seed.schedules();

/* ---------------- settings ---------------- */

export const getSettings = () => clone(db.settings);

export function saveSettings(next: Settings) {
  const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(db.settings[k]));
  db.settings = clone(next);
  db.company.name = next.companyName;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(db.settings));
  } catch {
    /* ignore */
  }
  if (changed.length) log('설정 변경', '설정', `${changed.length}개 항목 변경`, 'muted');
  return clone(db.settings);
}

export function pauseProtection() {
  log('보호 잠시 끄기', '전사', '1시간 동안 검사 없이 전송 · 자동 복귀 예정', 'block');
}

export function scheduleCompanyDelete() {
  log('회사 삭제 예약', db.company.name, '30일 뒤 실행 · 그 전에는 취소 가능', 'block');
}

/* ---------------- user portal ---------------- */

export const portalProfile = () => seed.portalProfile();
export const portalRecent = () => clone(db.portalRecent);

export function flagRecent(id: string) {
  const r = db.portalRecent.find((x) => x.id === id);
  if (!r) throw new Error('없는 기록이에요');
  r.flagged = !r.flagged;
  return clone(r);
}

export const portalRequests = () => clone(db.portalRequests);

export function createException(input: { reason: string; scope: '1회' | '1시간' | '24시간' }): PortalRequest {
  if (input.reason.trim().length < 20) throw new Error('사유를 20자 이상 적어 주세요');
  const id = `EXC-0${db.nextExc++}`;
  const exc: ExceptionRequest = {
    id, user: 'kim.mj', dept: '연구소', title: '조성비 포함 문서 번역 요청', sev: 'CRITICAL', sla: '2시간 남음', slaUrgent: 0,
    entity: '조성비 ×6 · 원료 공급처 1', scope: input.scope, rule: 'cos.formula.redact', target: 'ChatGPT · 브라우저 확장',
    history: '최근 30일 예외 승인 2회 · 오남용 기록 없음', reason: input.reason.trim(),
    alt: '외부 전송 없이 내부 번역 모델로 같은 문서를 처리할 수 있는지 먼저 확인하세요.', status: 'pending', requestedAt: `오늘 ${nowHm()}`,
  };
  db.exceptions.unshift(exc);
  const pr: PortalRequest = { id, status: 'PENDING', title: `조성비 포함 문서 번역 (${input.scope})`, note: '보안관리자 결정 대기 중이에요. 보통 2시간 안에 결정돼요.', when: `오늘 ${nowHm()}`, scope: `ChatGPT · ${input.scope}` };
  db.portalRequests.unshift(pr);
  return clone(pr);
}

export const lastBlockedSend = () => ({ when: '오늘 14:02', site: 'chatgpt.com', summary: '조성비 6건 · 원료 공급처 1건 — 첨부 파일 배합변경요청서_OEM.docx' });

export const history = () => (db.historyCleared ? [] : clone(db.history));
export function clearHistory() {
  db.historyCleared = true;
}
export const aliases = () => seed.aliases();
