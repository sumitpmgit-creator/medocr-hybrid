import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { Connect, PreviewServer, ViteDevServer } from 'vite';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;
const repoRoot = resolve(root, '../..');
const datasetsRoot = resolve(repoRoot, 'datasets');

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jsonl': 'application/jsonl; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function datasetsMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const raw = req.url ?? '';
    if (!raw.startsWith('/datasets/')) return next();
    const rel = decodeURIComponent(raw.split('?')[0]!.slice('/datasets/'.length));
    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) {
      res.statusCode = 400;
      res.end('Bad path');
      return;
    }
    const file = resolve(datasetsRoot, rel);
    if (!file.startsWith(datasetsRoot + '/') && file !== datasetsRoot) {
      res.statusCode = 400;
      res.end('Bad path');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(file).pipe(res);
  };
}

function serveDatasets() {
  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(datasetsMiddleware());
  };
  return {
    name: 'serve-datasets',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
  },
  preview: {
    port: 4173,
    fs: { allow: [repoRoot] },
  },
  plugins: [serveDatasets()],
  build: {
    target: 'chrome139',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
  },
});
