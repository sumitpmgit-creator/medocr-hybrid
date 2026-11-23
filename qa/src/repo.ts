// Paths into the monorepo. QA never writes outside qa/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(QA_DIR, '..');
export const pkgDir = (rel: string) => path.join(REPO, rel);
