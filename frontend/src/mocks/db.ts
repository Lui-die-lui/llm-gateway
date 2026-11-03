// The console's sign-in is the one thing still simulated: the gateway has no admin accounts, so the sign-in screen checks one
// fixed demo account here. Nothing else on the console reads this file (every other screen shows what the gateway really stores).
// src/api/console.ts is the only caller.
import type { ConsoleUser, LoginResult, OtpResult } from '../api/consoleTypes';

const MOCK_PASSWORD = 'test1234';
const ADMIN_EMAIL = 'admin@example.com';
const MAX_FAILS = 5;
const SETTINGS = { lockout: true, twoFactor: false };

let fails: Record<string, number> = {};
let otpTickets: Record<string, string> = {};

/** Tests call this between cases. */
export function resetMockDb(): void {
  fails = {};
  otpTickets = {};
}

const adminUser = (): ConsoleUser => ({ name: '보안관리자', email: ADMIN_EMAIL, role: 'admin', owner: true });

export function login(email: string, password: string): LoginResult {
  const id = email.trim().toLowerCase();
  const n = fails[id] ?? 0;
  if (SETTINGS.lockout && n >= MAX_FAILS) return { kind: 'locked', until: '15분 뒤' };
  if (id === ADMIN_EMAIL && password === MOCK_PASSWORD) {
    fails[id] = 0;
    if (SETTINGS.twoFactor) {
      const ticket = Math.random().toString(36).slice(2);
      otpTickets[ticket] = id;
      return { kind: 'otp', ticket, email: id };
    }
    return { kind: 'ok', user: adminUser(), lastLogin: '' };
  }
  if (id.endsWith('@example.com') && password === MOCK_PASSWORD) return { kind: 'notadmin' };
  fails[id] = n + 1;
  if (SETTINGS.lockout && n + 1 >= MAX_FAILS) return { kind: 'locked', until: '15분 뒤' };
  return { kind: 'wrong', remaining: SETTINGS.lockout ? MAX_FAILS - n - 1 : 99 };
}

export function verifyOtp(ticket: string, code: string): OtpResult {
  if (!otpTickets[ticket] || !/^\d{6}$/.test(code) || code === '000000') return { kind: 'wrong' };
  delete otpTickets[ticket];
  return { kind: 'ok', user: adminUser(), lastLogin: '' };
}

