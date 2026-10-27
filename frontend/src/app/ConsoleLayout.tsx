import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { onUnauthorized } from '../api/client';
import { Sidebar } from '../components/Sidebar';

export function ConsoleLayout() {
  const nav = useNavigate();
  const loc = useLocation();

  // Any 401 from the gateway sends the admin to the token screen, then back here.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (!window.location.pathname.endsWith('/console/token')) nav('/console/token', { state: { from: loc.pathname + loc.search } });
      }),
    [nav, loc.pathname, loc.search],
  );

  // A new page starts at the top unless it targets an anchor (#editor, #notify …).
  useEffect(() => {
    if (!loc.hash) window.scrollTo(0, 0);
  }, [loc.pathname, loc.hash]);

  return (
    <div className="app-shell">
      <div className="app-side">
        <Sidebar />
      </div>
      <main className="app-main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
