// Copia os arquivos .sql de migração para dist/ após a compilação TypeScript.
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
cpSync(path.join(root, 'src', 'migrations'), path.join(root, 'dist', 'migrations'), { recursive: true });
