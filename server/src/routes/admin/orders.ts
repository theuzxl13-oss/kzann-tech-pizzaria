import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, tenantAuth } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { withTenant } from '../../db.js';
import { ORDER_STATUSES } from '../../domain/orderFlow.js';
import { changeStatus, confirmManualPayment, getOrderDetail } from '../../services/orders.js';
import { idParam } from './crud.js';

const listQuery = z.object({
  status: z.string().optional(), // lista separada por vírgula
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ACTIVE = ['awaiting_payment', 'pending', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

export async function orderRoutes(f: FastifyInstance, app: AppContext) {
  /** Pedidos em andamento + concluídos/cancelados nas últimas 12h (quadro do painel). */
  f.get('/api/admin/orders/board', { preHandler: requirePerm('orders.view') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT o.*, COALESCE(json_agg(json_build_object('name', i.name, 'description', i.description, 'quantity', i.quantity, 'notes', i.notes)
                  ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
           FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
          WHERE o.status = ANY($1) OR o.created_at > now() - interval '12 hours'
          GROUP BY o.id ORDER BY o.created_at`,
        [ACTIVE],
      );
      return rows;
    });
  });

  /** Histórico com filtros. */
  f.get('/api/admin/orders', { preHandler: requirePerm('orders.view') }, async (req) => {
    const a = tenantAuth(req);
    const q = listQuery.parse(req.query);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const s = (await tx.query('SELECT timezone FROM tenant_settings')).rows[0];
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (q.status) {
        const statuses = q.status.split(',').filter((x) => (ORDER_STATUSES as readonly string[]).includes(x));
        if (statuses.length) add('status = ANY(?)', statuses);
      }
      params.push(s.timezone);
      const tz = `$${params.length}`;
      if (q.from) add(`(created_at AT TIME ZONE ${tz})::date >= ?::date`, q.from);
      if (q.to) add(`(created_at AT TIME ZONE ${tz})::date <= ?::date`, q.to);
      if (q.q) {
        const digits = q.q.replace(/\D/g, '');
        if (/^#?\d{1,7}$/.test(q.q)) add('number = ?', Number(digits));
        else {
          params.push(`%${q.q}%`);
          const p = `$${params.length}`;
          where.push(digits.length >= 4 ? `(customer_name ILIKE ${p} OR customer_phone LIKE '%${digits}%')` : `customer_name ILIKE ${p}`);
        }
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows } = await tx.query(
        `SELECT id, number, status, fulfillment, customer_name, customer_phone, payment_method, payment_status,
                total_cents, created_at, count(*) OVER() AS total_count
           FROM orders ${whereSql}
          ORDER BY created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      );
      return { orders: rows, total: rows[0]?.total_count ?? 0 };
    });
  });

  f.get('/api/admin/orders/:id', { preHandler: requirePerm('orders.view') }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    return withTenant(app.db, a.tenantId, (tx) => getOrderDetail(tx, id));
  });

  f.post('/api/admin/orders/:id/status', { preHandler: requirePerm('orders.view') }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ status: z.enum(ORDER_STATUSES), reason: z.string().trim().max(300).optional() }).parse(req.body);
    await changeStatus(app, a, id, body.status, body.reason);
    return withTenant(app.db, a.tenantId, (tx) => getOrderDetail(tx, id));
  });

  f.post('/api/admin/orders/:id/confirm-payment', { preHandler: requirePerm('payments.confirm') }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    await confirmManualPayment(app, a, id);
    return withTenant(app.db, a.tenantId, (tx) => getOrderDetail(tx, id));
  });

  /** Stream SSE do estabelecimento (novos pedidos e atualizações). */
  f.get('/api/admin/events', { preHandler: requirePerm('orders.view') }, async (req, reply) => {
    const a = tenantAuth(req);
    app.hub.stream(req, reply, (e) => e.tenantId === a.tenantId, ({ tenantId: _t, ...rest }) => rest);
  });

  /** Clientes do estabelecimento (histórico de compras). */
  f.get('/api/admin/customers', { preHandler: requirePerm('reports.view') }, async (req) => {
    const a = tenantAuth(req);
    const { q } = z.object({ q: z.string().trim().max(80).optional() }).parse(req.query);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.id, c.name, c.phone, c.orders_count, c.last_address, c.updated_at,
                COALESCE(sum(o.total_cents) FILTER (WHERE o.status = 'completed'), 0) AS total_spent_cents
           FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
          WHERE $1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.phone LIKE '%' || $1 || '%'
          GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100`,
        [q || null],
      );
      return rows;
    });
  });
}
