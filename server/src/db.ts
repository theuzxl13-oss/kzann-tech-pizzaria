import pg from 'pg';

// Retorna bigint/numeric como number (contagens e somas de centavos cabem em Number).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export interface DbContext {
  tenantId?: string | null;
  userId?: string | null;
}

export function createPool(connectionString: string, ssl = false): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
  });
}

/**
 * Executa `fn` numa transação com o contexto de RLS definido (app.tenant_id / app.user_id).
 * set_config(..., true) vale só para a transação corrente, então conexões do pool nunca
 * "vazam" o contexto de um estabelecimento para outro.
 */
export async function withTx<T>(db: Db, ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
      [ctx.tenantId ?? '', ctx.userId ?? ''],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>, userId?: string): Promise<T> {
  return withTx(db, { tenantId, userId }, fn);
}
