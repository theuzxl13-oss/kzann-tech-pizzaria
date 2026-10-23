import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './migrate.js';
import { reconcilePendingPix } from './services/orders.js';

const cfg = loadConfig();

if (process.env.MIGRATE_ON_START !== 'false') {
  const applied = await migrate(cfg.MIGRATION_DATABASE_URL || cfg.DATABASE_URL, cfg.DB_APP_ROLE, cfg.DB_SSL);
  if (applied.length) console.log(`Migrações aplicadas: ${applied.join(', ')}`);
}

const { app, ctx } = await buildApp(cfg);

// Reconciliação periódica de cobranças Pix (caso algum webhook se perca).
const reconcile = setInterval(() => {
  reconcilePendingPix(ctx).catch((err) => app.log.error({ err }, 'reconciliação falhou'));
}, 60_000);

const shutdown = async () => {
  clearInterval(reconcile);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: cfg.HOST, port: cfg.PORT });
