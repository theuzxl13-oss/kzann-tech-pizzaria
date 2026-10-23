import { buildApp } from './app.js';
import { loadConfig, shouldMigrateOnStart } from './config.js';
import { migrate } from './migrate.js';
import { reconcilePendingPix } from './services/orders.js';

const cfg = loadConfig();

// KZ-10: em produção as migrações rodam num passo separado (npm run migrate:prod), para o
// processo da aplicação não precisar da credencial do dono do schema.
if (shouldMigrateOnStart(cfg, process.env)) {
  const applied = await migrate(cfg.MIGRATION_DATABASE_URL || cfg.DATABASE_URL, cfg.DB_APP_ROLE, cfg.DB_SSL);
  if (applied.length) console.log(`Migrações aplicadas: ${applied.join(', ')}`);
}

const { app, ctx } = await buildApp(cfg);
if (cfg.NODE_ENV === 'production' && cfg.MIGRATION_DATABASE_URL) {
  app.log.warn('MIGRATION_DATABASE_URL está definida no processo da aplicação. Em produção, deixe-a apenas no passo de migração.');
}

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
