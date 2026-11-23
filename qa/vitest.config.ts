import { defineConfig } from 'vitest/config';

// Each test file is one QA area. Files run in isolated workers so global
// patches (fetch, navigator, LanguageModel) never leak between areas.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    isolate: true,
    // Core is imported from ../packages/core/src; allow Vite to transform it.
    server: { deps: { inline: [/packages\/core/, /packages\/parsing/] } },
  },
});
