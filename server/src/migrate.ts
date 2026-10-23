import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Aplica migrações pendentes (em ordem alfabética) e concede permissões ao papel da aplicação. */
export async function migrate(connectionString: string, appRole?: string, ssl = false): Promise<string[]> {
  const client = new pg.Client({ connectionString, ssl: ssl ? { rejectUnauthorized: true } : undefined });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(84719201)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
    }
    if (appRole) {
      const role = pg.escapeIdentifier(appRole);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.query(`REVOKE ALL ON schema_migrations FROM ${role}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(84719201)').catch(() => {});
    await client.end();
  }
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Defina MIGRATION_DATABASE_URL ou DATABASE_URL');
    process.exit(1);
  }
  migrate(url, process.env.DB_APP_ROLE, process.env.DB_SSL === 'true')
    .then((applied) => {
      console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
