import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode demo` (arquivo .env.demo → VITE_DEMO=1) gera a versão de demonstração estática
// para o GitHub Pages, que roda sem backend. O modo normal usa a API real (/api).
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const api = process.env.KZ_API_URL ?? 'http://localhost:3000';
  return {
    plugins: [react()],
    server: {
      port: demo ? 5174 : 5173,
      proxy: demo
        ? undefined
        : {
            '/api': { target: api },
            '/uploads': { target: api },
          },
    },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      sourcemap: false,
    },
  };
});
