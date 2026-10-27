import { describe, expect, it } from 'vitest';
import * as db from '../mocks/db';

describe('mock console server', () => {
  it('logs in the mock admin, refuses members, and locks after 5 failures', () => {
    expect(db.login('admin@example.com', 'test1234').kind).toBe('ok');
    expect(db.login('minji.kim@example.com', 'test1234').kind).toBe('notadmin');
    for (let i = 0; i < 4; i++) expect(db.login('admin@example.com', 'bad').kind).toBe('wrong');
    expect(db.login('admin@example.com', 'bad').kind).toBe('locked');
    expect(db.login('admin@example.com', 'test1234').kind).toBe('locked');
  });

  it('asks for a 6-digit code only when 2FA is on', () => {
    db.saveSettings({ ...db.getSettings(), twoFactor: true });
    const r = db.login('admin@example.com', 'test1234');
    expect(r.kind).toBe('otp');
    if (r.kind !== 'otp') return;
    expect(db.verifyOtp(r.ticket, '000000').kind).toBe('wrong');
    expect(db.verifyOtp(r.ticket, '123456').kind).toBe('ok');
  });

  it('counts pending policy changes and clears them on apply', () => {
    const before = db.getPolicy();
    expect(before.pending).toHaveLength(3);
    db.toggleRule('r70');
    expect(db.getPolicy().pending).toHaveLength(4);
    const r = db.applyPolicy();
    expect(r).toEqual({ version: 15, applied: 4 });
    expect(db.getPolicy().pending).toHaveLength(0);
    expect(db.listAdminLog()[0]?.act).toBe('규칙 적용');
  });

  it('a request from the portal reaches the admin and the decision goes back', () => {
    const pr = db.createException({ reason: '해외 파트너 번역이라 수치가 그대로 필요합니다 확인 부탁', scope: '1회' });
    expect(db.listExceptions()[0]).toMatchObject({ id: pr.id, status: 'pending' });
    db.decideException(pr.id, 'approved', '1h', '');
    expect(db.portalRequests().find((p) => p.id === pr.id)?.status).toBe('APPROVED');
    expect(() => db.createException({ reason: '짧음', scope: '1회' })).toThrow();
  });

  it('protects the owner and the last admin', () => {
    expect(() => db.setMemberRole('m1', 'member')).toThrow('소유자');
    expect(() => db.setMemberStatus('m1', 'inactive')).toThrow();
    db.setMemberRole('m2', 'member');
    expect(db.listMembers().find((m) => m.id === 'm2')?.role).toBe('member');
  });
});
