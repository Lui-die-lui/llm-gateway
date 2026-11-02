import { describe, expect, it } from 'vitest';
import { formatRemaining, grantTime } from '../api/exceptions';
import type { PortalRequest } from '../api/consoleTypes';

const base: PortalRequest = { id: 'REQ-1', status: 'APPROVED', title: 't', note: 'n', when: 'w', scope: 's', ttl: '1h', decidedAt: 1000, used: false };

describe('grantTime', () => {
  it('counts down an approval that is still running', () => {
    expect(grantTime(base, 1000 + 600)).toEqual({ kind: 'running', remainingSeconds: 3000, endsAt: 4600 });
  });
  it('says an approval is over once the time has passed', () => {
    expect(grantTime(base, 4600)).toEqual({ kind: 'ended' });
    expect(grantTime(base, 99999)).toEqual({ kind: 'ended' });
  });
  it('tells a one-use approval apart before and after it is spent', () => {
    expect(grantTime({ ...base, ttl: '1x' }, 2000)).toEqual({ kind: 'once-open' });
    expect(grantTime({ ...base, ttl: '1x', used: true }, 2000)).toEqual({ kind: 'once-used' });
  });
  it('shows nothing for requests that are not approved, or are mock rows', () => {
    expect(grantTime({ ...base, status: 'PENDING' }, 2000)).toBeNull();
    expect(grantTime({ ...base, status: 'REJECTED' }, 2000)).toBeNull();
    expect(grantTime({ ...base, id: 'EXC-1' }, 2000)).toBeNull();
  });
});

describe('formatRemaining', () => {
  it('reads naturally at each size', () => {
    expect(formatRemaining(3725)).toBe('1시간 2분');
    expect(formatRemaining(90)).toBe('1분 30초');
    expect(formatRemaining(45)).toBe('45초');
    expect(formatRemaining(1500)).toBe('25분');
    expect(formatRemaining(90000)).toBe('1일 1시간');
    expect(formatRemaining(-5)).toBe('0초');
  });
});
