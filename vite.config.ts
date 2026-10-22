import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  base: './',
  // teach.html is the classroom kit's own page, beside the app.
  build: { target: 'es2022', chunkSizeWarningLimit: 1200, rolldownOptions: { input: { main: page('index.html'), teach: page('teach.html') } } },
  // The physics tests run real solvers; on a busy or slow machine some take longer than Vitest's 5 s default.
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
