// Serves the benchmark page. Reuses apps/web's dependencies, Firebase env (.env.local) and stages
// without modifying apps/. Started automatically by `run.ts --driver browser --serve`.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../..');
export default {
  root: here,
  envDir: resolve(repo, 'apps/web'),
  server: { port: 5174, strictPort: true, fs: { allow: [repo] } },
  resolve: { alias: { '@med-ocr/core': resolve(repo, 'packages/core/src/index.ts') } },
  // firebase lives in apps/web/node_modules; let Vite find it from there.
  optimizeDeps: { entries: [resolve(here, 'bench.ts')] },
  // Generated cache lives OUTSIDE the repo (public tree): never write caches/profiles into med-ocr/.
  cacheDir: process.env.MEDOCR_VITE_CACHE ?? '/workspace/sage-vite-cache',
};
