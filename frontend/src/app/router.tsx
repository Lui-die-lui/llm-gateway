import { Navigate, createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../features/auth';
import { ConsoleLayout } from './ConsoleLayout';
import { LoginPage } from '../pages/console/Login';
import { TokenPage } from '../pages/console/Token';
import { OverviewPage } from '../pages/console/Overview';
import { LivePage } from '../pages/console/Live';
import { LogsPage } from '../pages/console/Logs';
import { ReportsPage } from '../pages/console/Reports';
import { PolicyPage } from '../pages/console/Policy';
import { BasicRulesPage } from '../pages/console/BasicRules';
import { SettingsPage } from '../pages/console/Settings';
import { ExceptionsPage } from '../pages/console/Exceptions';
import { PortalPage } from '../pages/portal/Portal';
import { RequestPage } from '../pages/portal/Request';

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
      { path: 'logs', element: <LogsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'policy', element: <PolicyPage /> },
      { path: 'policy/basic', element: <BasicRulesPage /> },
      { path: 'exceptions', element: <ExceptionsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'token', element: <TokenPage /> },
    ],
  },
  { path: '/me', element: <PortalPage /> },
  { path: '/me/request', element: <RequestPage /> },
  { path: '*', element: <Navigate to="/console" replace /> },
];

export const createRouter = () => createBrowserRouter(routes);
