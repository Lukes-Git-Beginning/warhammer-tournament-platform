import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const BACKEND_PORT = process.env.BACKEND_PORT ?? '3000';
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT ?? 5173);

export default defineConfig({
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
      '/socket.io': { target: `http://localhost:${BACKEND_PORT}`, changeOrigin: true, ws: true },
    },
  },
});
