// Console session (mock login for now). Kept in sessionStorage so it ends with the tab, and dropped after the
// idle time (30 minutes).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ConsoleUser } from '../api/consoleTypes';
import { consoleApi } from '../api/console';
import { qk } from './queries';

const KEY = 'gw.console.session';

interface Session {
  user: ConsoleUser;
  lastLogin: string;
  lastActive: number;
}

interface AuthApi {
  session: Session | null;
  expired: boolean;
  signIn: (user: ConsoleUser, lastLogin: string) => void;
  signOut: (reason?: 'expired') => void;
}

const Ctx = createContext<AuthApi | null>(null);

function read(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function write(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: session lasts until reload */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(read);
  const [expired, setExpired] = useState(false);
  const settings = useQuery({ queryKey: qk.settings, queryFn: consoleApi.settings, enabled: !!session });
  const idleMs = (settings.data?.idleMinutes ?? 30) * 60_000;

  const signIn = useCallback((user: ConsoleUser, lastLogin: string) => {
    const s = { user, lastLogin, lastActive: Date.now() };
    write(s);
    setExpired(false);
    setSession(s);
  }, []);

  const signOut = useCallback((reason?: 'expired') => {
    write(null);
    setExpired(reason === 'expired');
    setSession(null);
  }, []);

  useEffect(() => {
    if (!session) return;
    if (Date.now() - session.lastActive > idleMs) {
      signOut('expired');
      return;
    }
    let last = Date.now();
    const touch = () => {
      const now = Date.now();
      if (now - last < 5000) return;
      last = now;
      const cur = read();
      if (cur) write({ ...cur, lastActive: now });
    };
    const check = setInterval(() => {
      const cur = read();
      if (!cur || Date.now() - cur.lastActive > idleMs) signOut('expired');
    }, 20_000);
    const evs = ['pointerdown', 'keydown', 'wheel'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => {
      clearInterval(check);
      evs.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [session, idleMs, signOut]);

  const api = useMemo(() => ({ session, expired, signIn, signOut }), [session, expired, signIn, signOut]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** Console route guard. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, expired } = useAuth();
  const loc = useLocation();
  if (!session) {
    return <Navigate to={expired ? '/login?expired=1' : '/login'} replace state={{ from: loc.pathname + loc.search + loc.hash }} />;
  }
  return <>{children}</>;
}
