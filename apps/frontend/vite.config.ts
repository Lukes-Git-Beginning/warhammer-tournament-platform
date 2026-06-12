import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Load root .env so worktrees can set BACKEND_PORT / FRONTEND_PORT
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '');
  const BACKEND_PORT = env.BACKEND_PORT ?? '3000';
  const FRONTEND_PORT = Number(env.FRONTEND_PORT ?? 5173);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: FRONTEND_PORT,
      proxy: {
        '/api': { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true },
        '/auth': { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true },
        '/uploads': { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true },
        '/socket.io': { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true, ws: true },
      },
    },
  };
});
