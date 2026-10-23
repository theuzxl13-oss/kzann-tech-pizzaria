import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, tenantAuth } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { withTenant, type Tx } from '../../db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { Permission } from '../../lib/permissions.js';
import { audit } from '../../services/tenants.js';

export const idParam = z.object({ id: z.string().uuid() });

interface CrudOptions<S extends z.ZodObject<any>> {
  path: string; // ex.: /api/admin/menu/products
  table: string;
  schema: S;
  orderBy?: string;
  perm?: Permission;
  /** Campos alteráveis por quem tem apenas menu.availability. */
  availabilityField?: boolean;
  /** Tabela de preços por tamanho (sabores e bordas). */
  prices?: { table: string; fk: string };
  /** Validação extra dentro da transação (ex.: categoria pertence ao estabelecimento — garantida também pelo RLS). */
  beforeWrite?: (tx: Tx, data: any) => Promise<void>;
}

/**
 * CRUD genérico isolado por estabelecimento: tenant_id vem SEMPRE da sessão,
 * e o RLS do PostgreSQL rejeita qualquer acesso a linhas de outro estabelecimento.
 */
export function registerCrud<S extends z.ZodObject<any>>(f: FastifyInstance, app: AppContext, o: CrudOptions<S>) {
  const perm = o.perm ?? 'menu.manage';
  const priceSchema = z.record(z.string().uuid(), z.number().int().min(0).max(10_000_000).nullable()).optional();
  const createSchema = o.prices ? o.schema.extend({ prices: priceSchema }) : o.schema;
  const updateSchema = createSchema.partial();
  const cols = Object.keys(o.schema.shape);

  const withPrices = async (tx: Tx, rows: any[]) => {
    if (!o.prices) return rows;
    const { rows: prices } = await tx.query(`SELECT ${o.prices.fk} AS owner, size_id, price_cents FROM ${o.prices.table}`);
    return rows.map((r) => ({
      ...r,
      prices: Object.fromEntries(prices.filter((p) => p.owner === r.id).map((p) => [p.size_id, p.price_cents])),
    }));
  };

  const savePrices = async (tx: Tx, tenantId: string, ownerId: string, prices?: Record<string, number | null>) => {
    if (!o.prices || !prices) return;
    // Chaves estrangeiras ignoram RLS: confirma que os tamanhos são deste estabelecimento.
    const sizeIds = Object.keys(prices);
    const { rows: own } = await tx.query('SELECT id FROM pizza_sizes WHERE id = ANY($1::uuid[])', [sizeIds]);
    if (own.length !== sizeIds.length) throw badRequest('invalid_size', 'Tamanho inválido');
    for (const [sizeId, cents] of Object.entries(prices)) {
      if (cents === null) {
        await tx.query(`DELETE FROM ${o.prices.table} WHERE ${o.prices.fk} = $1 AND size_id = $2`, [ownerId, sizeId]);
      } else {
        await tx.query(
          `INSERT INTO ${o.prices.table} (tenant_id, ${o.prices.fk}, size_id, price_cents) VALUES ($1, $2, $3, $4)
           ON CONFLICT (${o.prices.fk}, size_id) DO UPDATE SET price_cents = EXCLUDED.price_cents`,
          [tenantId, ownerId, sizeId, cents],
        );
      }
    }
  };

  f.get(o.path, { preHandler: requirePerm('orders.view') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(`SELECT * FROM ${o.table} ORDER BY ${o.orderBy ?? 'sort, name'}`);
      return withPrices(tx, rows);
    });
  });

  f.post(o.path, { preHandler: requirePerm(perm) }, async (req, reply) => {
    const a = tenantAuth(req);
    const body = createSchema.parse(req.body) as Record<string, any>;
    const row = await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        await o.beforeWrite?.(tx, body);
        const present = cols.filter((c) => body[c] !== undefined);
        const values = present.map((c) => body[c]);
        const { rows } = await tx.query(
          `INSERT INTO ${o.table} (tenant_id, ${present.join(', ')}) VALUES ($1, ${present.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
          [a.tenantId, ...values],
        );
        await savePrices(tx, a.tenantId, rows[0].id, body.prices);
        await audit(tx, a.tenantId, a.userId, 'create', o.table, rows[0].id);
        return (await withPrices(tx, rows))[0];
      },
      a.userId,
    );
    return reply.code(201).send(row);
  });

  f.patch(`${o.path}/:id`, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body) as Record<string, any>;
    const keys = Object.keys(body).filter((k) => body[k] !== undefined);
    // Equipe com permissão só de disponibilidade (cozinha/atendente) pode pausar itens esgotados.
    const onlyAvailability = o.availabilityField && keys.length > 0 && keys.every((k) => k === 'available');
    await requirePerm(onlyAvailability ? 'menu.availability' : perm)(req);
    return withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        await o.beforeWrite?.(tx, body);
        const present = cols.filter((c) => body[c] !== undefined);
        let row;
        if (present.length) {
          const { rows } = await tx.query(
            `UPDATE ${o.table} SET ${present.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
            [id, ...present.map((c) => body[c])],
          );
          row = rows[0];
        } else {
          row = (await tx.query(`SELECT * FROM ${o.table} WHERE id = $1`, [id])).rows[0];
        }
        if (!row) throw notFound();
        await savePrices(tx, a.tenantId, id, body.prices);
        await audit(tx, a.tenantId, a.userId, 'update', o.table, id, body);
        return (await withPrices(tx, [row]))[0];
      },
      a.userId,
    );
  });

  f.delete(`${o.path}/:id`, { preHandler: requirePerm(perm) }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        let rowCount: number | null;
        try {
          ({ rowCount } = await tx.query(`DELETE FROM ${o.table} WHERE id = $1`, [id]));
        } catch (err: any) {
          // 23503 = foreign_key_violation (NO ACTION), 23001 = restrict_violation (ON DELETE RESTRICT)
          if (err?.code === '23503' || err?.code === '23001') {
            throw conflict('in_use', 'Não é possível excluir: existem itens vinculados. Mova ou exclua esses itens antes, ou apenas oculte este registro.');
          }
          throw err;
        }
        if (!rowCount) throw notFound();
        await audit(tx, a.tenantId, a.userId, 'delete', o.table, id);
      },
      a.userId,
    );
    return { ok: true };
  });
}
