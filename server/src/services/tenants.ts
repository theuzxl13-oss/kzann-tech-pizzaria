import type { Db, Tx } from '../db.js';
import { resolveOpenStatus, type OpeningInterval } from '../domain/hours.js';
import { notFound } from '../lib/errors.js';

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
}

/** Resolve o estabelecimento pelo slug do link público (tabela tenants é legível sem contexto). */
export async function findTenantBySlug(db: Db, slug: string): Promise<TenantRow> {
  const { rows } = await db.query<TenantRow>('SELECT id, slug, name, status FROM tenants WHERE slug = $1', [slug.toLowerCase()]);
  const tenant = rows[0];
  if (!tenant || tenant.status !== 'active') throw notFound('Pizzaria não encontrada');
  return tenant;
}

export async function getSettings(tx: Tx) {
  const { rows } = await tx.query('SELECT * FROM tenant_settings');
  if (!rows[0]) throw notFound('Configurações não encontradas');
  return rows[0];
}

export async function getHours(tx: Tx): Promise<OpeningInterval[]> {
  const { rows } = await tx.query(
    "SELECT weekday, to_char(opens, 'HH24:MI') AS opens, to_char(closes, 'HH24:MI') AS closes FROM opening_hours ORDER BY weekday, opens",
  );
  return rows;
}

export async function isOpenNow(tx: Tx, settings: { manual_status: 'auto' | 'open' | 'closed'; timezone: string }) {
  return resolveOpenStatus(settings.manual_status, await getHours(tx), settings.timezone);
}

export async function gatewayEnabled(tx: Tx): Promise<boolean> {
  const { rows } = await tx.query(
    "SELECT 1 FROM payment_gateways WHERE provider = 'mercadopago' AND enabled AND access_token_enc IS NOT NULL AND webhook_secret_enc IS NOT NULL",
  );
  return rows.length > 0;
}

export async function audit(tx: Tx, tenantId: string, userId: string | null, action: string, entity?: string, entityId?: string, data?: unknown) {
  await tx.query(
    'INSERT INTO audit_logs (tenant_id, user_id, action, entity, entity_id, data) VALUES ($1, $2, $3, $4, $5, $6)',
    [tenantId, userId, action, entity ?? null, entityId ?? null, data === undefined ? null : JSON.stringify(data)],
  );
}
