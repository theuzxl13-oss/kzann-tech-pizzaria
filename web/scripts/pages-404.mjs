// GitHub Pages não tem fallback de SPA: o 404.html redireciona a rota profunda
// para index.html?p=/rota, que o main.tsx restaura com history.replaceState.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-demo');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Redirecionando…</title>
<script>
  var base = location.pathname.split('/').slice(0, 2).join('/');
  var isProjectSite = location.hostname.endsWith('github.io');
  var root = isProjectSite ? base : '';
  location.replace(root + '/?p=' + encodeURIComponent(location.pathname.slice(root.length)) + location.hash);
</script></head><body></body></html>`;
writeFileSync(path.join(dist, '404.html'), html);
writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('404.html e .nojekyll gerados em', dist);
