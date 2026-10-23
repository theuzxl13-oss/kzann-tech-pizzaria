/**
 * PostgreSQL local para DESENVOLVIMENTO (binários oficiais via pacote embedded-postgres).
 * Em produção use um PostgreSQL gerenciado e configure DATABASE_URL / MIGRATION_DATABASE_URL.
 *
 * Cria (na primeira execução):
 *  - superusuário "postgres" (usado apenas para migrações)
 *  - papel "kzann_app" SEM superuser/BYPASSRLS (usado pela aplicação → RLS é aplicado)
 *  - banco "kzann"
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '..', '.pgdata');
const port = Number(process.env.DEV_PG_PORT ?? 54329);
const adminPassword = process.env.DEV_PG_PASSWORD ?? 'postgres';
const appPassword = process.env.DEV_PG_APP_PASSWORD ?? 'kzann_app_dev';

const firstRun = !existsSync(path.join(dataDir, 'PG_VERSION'));
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: adminPassword,
  port,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

if (firstRun) await pg.initialise();
await pg.start();

if (firstRun) {
  await pg.createDatabase('kzann');
  const client = pg.getPgClient();
  await client.connect();
  await client.query(`CREATE ROLE kzann_app LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS`);
  await client.query('GRANT CONNECT, TEMP ON DATABASE kzann TO kzann_app');
  await client.end();
}

console.log(`PostgreSQL de desenvolvimento rodando na porta ${port}`);
console.log(`  MIGRATION_DATABASE_URL=postgres://postgres:${adminPassword}@localhost:${port}/kzann`);
console.log(`  DATABASE_URL=postgres://kzann_app:${appPassword}@localhost:${port}/kzann`);
console.log('Ctrl+C para parar.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
