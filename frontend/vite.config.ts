/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The admin token never goes into the bundle. In dev, the proxy below reads GATEWAY_ADMIN_TOKEN from the
// shell that started `npm run dev` (same variable the gateway uses) and attaches it server-side.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_GATEWAY_URL || 'http://localhost:8000';
  const adminToken = process.env.GATEWAY_ADMIN_TOKEN;
  return {
    plugins: [react()],
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        '/gw': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/gw/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              if (adminToken && !req.getHeader('x-admin-token')) req.setHeader('X-Admin-Token', adminToken);
            });
          },
        },
      },
    },
    preview: { port: 3000, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
