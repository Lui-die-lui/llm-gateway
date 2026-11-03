import { describe, expect, it } from 'vitest';
import * as db from '../mocks/db';

// The only simulated thing left is the console's sign-in gate.
describe('console sign-in gate', () => {
  it('logs in the demo admin, refuses members, and locks after 5 failures', () => {
    expect(db.login('admin@example.com', 'test1234').kind).toBe('ok');
    expect(db.login('minji.kim@example.com', 'test1234').kind).toBe('notadmin');
    for (let i = 0; i < 4; i++) expect(db.login('admin@example.com', 'bad').kind).toBe('wrong');
    expect(db.login('admin@example.com', 'bad').kind).toBe('locked');
    expect(db.login('admin@example.com', 'test1234').kind).toBe('locked');
  });

  it('never reports a made-up "last login"', () => {
    const r = db.login('admin@example.com', 'test1234');
    expect(r.kind === 'ok' && r.lastLogin).toBe('');
  });

  it('only says how long the console may sit idle', () => {
    expect(db.getSettings().idleMinutes).toBe(30);
  });
});
