import { Navigate, createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../features/auth';
import { ConsoleLayout } from './ConsoleLayout';
import { LoginPage } from '../pages/console/Login';
import { TokenPage } from '../pages/console/Token';
import { OverviewPage } from '../pages/console/Overview';
import { LivePage } from '../pages/console/Live';

export const routes = [
  { path: '/', element: <Navigate to="/console" replace /> },
  { path: '/login', element: <LoginPage /> },
  {
    path: '/console',
    element: (
      <RequireAuth>
        <ConsoleLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'live', element: <LivePage /> },
      { path: 'token', element: <TokenPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/console" replace /> },
];

export const createRouter = () => createBrowserRouter(routes);
