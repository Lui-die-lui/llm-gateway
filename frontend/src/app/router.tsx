import { Navigate, createBrowserRouter } from 'react-router-dom';
import { RequireAuth } from '../features/auth';
import { ConsoleLayout } from './ConsoleLayout';
import { LoginPage } from '../pages/console/Login';
import { TokenPage } from '../pages/console/Token';


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
      { index: true, element: <Navigate to="/console/token" replace /> },
      { path: 'token', element: <TokenPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/console" replace /> },
];

export const createRouter = () => createBrowserRouter(routes);
