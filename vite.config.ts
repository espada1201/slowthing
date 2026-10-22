import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // The physics tests run real solvers; on a busy or slow machine some take longer than Vitest's 5 s default.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
