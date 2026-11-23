import { defineConfig, type Plugin } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const QA = path.dirname(fileURLToPath(import.meta.url));

/**
 * Redirects Firebase imports made by product code (apps/web, packages/*) to the
 * QA mocks, so the real Stages run with Gemini Nano and Firebase AI Logic mocked
 * and every cloud byte flows through the EgressSpy. Product files are NOT edited.
 */
function mockFirebase(): Plugin {
  return {
    name: 'qa-mock-firebase',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'firebase/ai') return path.join(QA, 'src/mocks/firebase-ai-sdk.ts');
      if (importer && /apps[\\/]web[\\/]src[\\/]/.test(importer) && /^\.\/firebase(\.ts)?$/.test(source)) return path.join(QA, 'src/mocks/web-firebase.ts');
      return null;
    },
  };
}

export default defineConfig({
  plugins: [mockFirebase()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    isolate: true,
    server: { deps: { inline: [/packages[\\/]/, /apps[\\/]web/] } },
  },
});
