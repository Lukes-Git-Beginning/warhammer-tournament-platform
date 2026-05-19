import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: [path.resolve(__dirname, './src/test-setup.ts')],
    alias: {
      '@/': path.resolve(__dirname, './src') + '/',
    },
  },
});
