import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
  build: { target: 'chrome139' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
  },
});
