import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, tenantAuth } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { withTenant, type Tx } from '../../db.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit } from '../../services/tenants.js';
import { idParam } from './crud.js';

const rangeQuery = z.object({ from: z.string().date(), to: z.string().date() });

/** Resumo de um período de caixa: recebimentos por forma de pagamento e dinheiro esperado na gaveta. */
async function cashSummary(tx: Tx, session: any) {
  const until = session.closed_at ?? new Date();
  // KZ-06: só conta como recebido o que continua pago; cancelados após pagamento aparecem em "devoluções".
  const { rows: byMethod } = await tx.query(
    `SELECT payment_method, count(*)::int AS orders, COALESCE(sum(total_cents), 0)::int AS total_cents
       FROM orders WHERE payment_status = 'paid' AND paid_at >= $1 AND paid_at <= $2
      GROUP BY payment_method ORDER BY payment_method`,
    [session.opened_at, until],
  );
  const { rows: refunds } = await tx.query(
    `SELECT id, number, customer_name, payment_method, payment_status, total_cents FROM orders
      WHERE payment_status IN ('refund_pending', 'refunded') AND paid_at >= $1 AND paid_at <= $2 ORDER BY number`,
    [session.opened_at, until],
  );
  const { rows: movements } = await tx.query(
    `SELECT m.*, u.name AS user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE session_id = $1 ORDER BY created_at`,
    [session.id],
  );
  const cash = byMethod.find((r) => r.payment_method === 'cash')?.total_cents ?? 0;
  const supplies = movements.filter((m) => m.type === 'supply').reduce((s, m) => s + m.amount_cents, 0);
  const withdrawals = movements.filter((m) => m.type === 'withdrawal').reduce((s, m) => s + m.amount_cents, 0);
  const { rows: cancelled } = await tx.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total_cents), 0)::int AS total_cents FROM orders
      WHERE status = 'cancelled' AND cancelled_at >= $1 AND cancelled_at <= $2`,
    [session.opened_at, until],
  );
  // Dinheiro "a devolver" ainda está fisicamente na gaveta até a equipe confirmar a devolução.
  const cashToReturn = refunds
    .filter((r) => r.payment_method === 'cash' && r.payment_status === 'refund_pending')
    .reduce((s, r) => s + r.total_cents, 0);
  return {
    by_method: byMethod,
    total_received_cents: byMethod.reduce((s, r) => s + r.total_cents, 0),
    movements,
    supplies_cents: supplies,
    withdrawals_cents: withdrawals,
    refunds,
    cash_to_return_cents: cashToReturn,
    expected_cash_cents: session.opening_cents + cash + cashToReturn + supplies - withdrawals,
    cancelled: cancelled[0],
  };
}

export async function reportRoutes(f: FastifyInstance, app: AppContext) {
  f.get('/api/admin/reports/sales', { preHandler: requirePerm('reports.view') }, async (req) => {
    const a = tenantAuth(req);
    const { from, to } = rangeQuery.parse(req.query);
    if (from > to) throw badRequest('invalid_range', 'Período inválido');
    return withTenant(app.db, a.tenantId, async (tx) => {
      const tz = (await tx.query('SELECT timezone FROM tenant_settings')).rows[0].timezone;
      const range = `(o.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date`;
      const p = [tz, from, to];
      const one = async (sql: string) => (await tx.query(sql, p)).rows;
      const [summary] = await one(`
        SELECT count(*) FILTER (WHERE status <> 'cancelled' AND status <> 'awaiting_payment')::int AS orders,
               count(*) FILTER (WHERE status = 'completed')::int AS completed,
               COALESCE(sum(total_cents) FILTER (WHERE status = 'completed'), 0)::int AS revenue_cents,
               COALESCE(sum(delivery_fee_cents) FILTER (WHERE status = 'completed'), 0)::int AS delivery_fees_cents,
               COALESCE(sum(discount_cents) FILTER (WHERE status = 'completed'), 0)::int AS discounts_cents,
               count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
               COALESCE(sum(total_cents) FILTER (WHERE status = 'cancelled'), 0)::int AS cancelled_cents,
               COALESCE(round(avg(total_cents) FILTER (WHERE status = 'completed')), 0)::int AS avg_ticket_cents,
               COALESCE(round(avg(EXTRACT(EPOCH FROM completed_at - created_at) / 60) FILTER (WHERE status = 'completed')), 0)::int AS avg_minutes
          FROM orders o WHERE ${range}`);
      const byDay = await one(`
        SELECT to_char((o.created_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE status = 'completed')::int AS orders,
               COALESCE(sum(total_cents) FILTER (WHERE status = 'completed'), 0)::int AS revenue_cents
          FROM orders o WHERE ${range} GROUP BY 1 ORDER BY 1`);
      const byPayment = await one(`
        SELECT payment_method, count(*)::int AS orders, sum(total_cents)::int AS total_cents
          FROM orders o WHERE ${range} AND status = 'completed' GROUP BY 1 ORDER BY 3 DESC`);
      const byFulfillment = await one(`
        SELECT fulfillment, count(*)::int AS orders, sum(total_cents)::int AS total_cents
          FROM orders o WHERE ${range} AND status = 'completed' GROUP BY 1`);
      const byHour = await one(`
        SELECT EXTRACT(HOUR FROM o.created_at AT TIME ZONE $1)::int AS hour, count(*)::int AS orders
          FROM orders o WHERE ${range} AND status = 'completed' GROUP BY 1 ORDER BY 1`);
      const topProducts = await one(`
        SELECT i.name, sum(i.quantity)::int AS quantity, sum(i.total_cents)::int AS total_cents
          FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE ${range} AND o.status = 'completed' AND i.kind = 'product'
         GROUP BY i.name ORDER BY 2 DESC LIMIT 10`);
      const topFlavors = await one(`
        SELECT f->>'name' AS name,
               round(sum(i.quantity::numeric / jsonb_array_length(i.details->'flavors')), 1)::float AS pizzas
          FROM order_items i JOIN orders o ON o.id = i.order_id
          CROSS JOIN LATERAL jsonb_array_elements(i.details->'flavors') f
         WHERE ${range} AND o.status = 'completed' AND i.kind = 'pizza'
         GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
      const coupons = await one(`
        SELECT coupon_code, count(*)::int AS orders, sum(discount_cents)::int AS discount_cents
          FROM orders o WHERE ${range} AND status = 'completed' AND coupon_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`);
      const cancellations = await one(`
        SELECT number, customer_name, total_cents, cancel_reason, cancelled_at
          FROM orders o WHERE ${range} AND status = 'cancelled' ORDER BY cancelled_at DESC LIMIT 100`);
      return {
        summary,
        by_day: byDay,
        by_payment: byPayment,
        by_fulfillment: byFulfillment,
        by_hour: byHour,
        top_products: topProducts,
        top_flavors: topFlavors,
        coupons,
        cancellations,
      };
    });
  });

  // ───────── Caixa ─────────
  f.get('/api/admin/cash/current', { preHandler: requirePerm('cash.manage') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.*, u.name AS opened_by_name FROM cash_sessions s LEFT JOIN users u ON u.id = s.opened_by WHERE s.status = 'open'`,
      );
      if (!rows[0]) return { session: null };
      return { session: rows[0], summary: await cashSummary(tx, rows[0]) };
    });
  });

  f.post('/api/admin/cash/open', { preHandler: requirePerm('cash.manage') }, async (req, reply) => {
    const a = tenantAuth(req);
    const { opening_cents } = z.object({ opening_cents: z.number().int().min(0).max(10_000_000) }).parse(req.body);
    const row = await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        const open = await tx.query("SELECT 1 FROM cash_sessions WHERE status = 'open'");
        if (open.rows.length) throw conflict('cash_open', 'Já existe um caixa aberto');
        const { rows } = await tx.query(
          'INSERT INTO cash_sessions (tenant_id, opened_by, opening_cents) VALUES ($1, $2, $3) RETURNING *',
          [a.tenantId, a.userId, opening_cents],
        );
        await audit(tx, a.tenantId, a.userId, 'open', 'cash_session', rows[0].id, { opening_cents });
        return rows[0];
      },
      a.userId,
    );
    return reply.code(201).send(row);
  });

  f.post('/api/admin/cash/movements', { preHandler: requirePerm('cash.manage') }, async (req, reply) => {
    const a = tenantAuth(req);
    const body = z
      .object({
        type: z.enum(['supply', 'withdrawal']),
        amount_cents: z.number().int().min(1).max(10_000_000),
        reason: z.string().trim().min(2, 'Informe o motivo').max(200),
      })
      .parse(req.body);
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        const s = (await tx.query("SELECT id FROM cash_sessions WHERE status = 'open'")).rows[0];
        if (!s) throw conflict('cash_closed', 'Abra o caixa primeiro');
        await tx.query(
          'INSERT INTO cash_movements (tenant_id, session_id, type, amount_cents, reason, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [a.tenantId, s.id, body.type, body.amount_cents, body.reason, a.userId],
        );
      },
      a.userId,
    );
    return reply.code(201).send({ ok: true });
  });

  f.post('/api/admin/cash/close', { preHandler: requirePerm('cash.manage') }, async (req) => {
    const a = tenantAuth(req);
    const body = z
      .object({ counted_cents: z.number().int().min(0).max(100_000_000), notes: z.string().trim().max(500).optional() })
      .parse(req.body);
    return withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        const s = (await tx.query("SELECT * FROM cash_sessions WHERE status = 'open' FOR UPDATE")).rows[0];
        if (!s) throw conflict('cash_closed', 'Não há caixa aberto');
        const closedAt = new Date();
        const summary = await cashSummary(tx, { ...s, closed_at: closedAt });
        const { rows } = await tx.query(
          `UPDATE cash_sessions SET status = 'closed', closed_by = $2, closed_at = $3, counted_cents = $4,
                  expected_cents = $5, summary = $6, notes = $7 WHERE id = $1 RETURNING *`,
          [s.id, a.userId, closedAt, body.counted_cents, summary.expected_cash_cents, JSON.stringify(summary), body.notes ?? ''],
        );
        await audit(tx, a.tenantId, a.userId, 'close', 'cash_session', s.id, {
          counted_cents: body.counted_cents,
          expected_cents: summary.expected_cash_cents,
        });
        return { session: rows[0], summary, difference_cents: body.counted_cents - summary.expected_cash_cents };
      },
      a.userId,
    );
  });

  f.get('/api/admin/cash/sessions', { preHandler: requirePerm('cash.manage') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.id, s.status, s.opened_at, s.closed_at, s.opening_cents, s.counted_cents, s.expected_cents,
                uo.name AS opened_by_name, uc.name AS closed_by_name
           FROM cash_sessions s LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by
          ORDER BY s.opened_at DESC LIMIT 60`,
      );
      return rows;
    });
  });

  f.get('/api/admin/cash/sessions/:id', { preHandler: requirePerm('cash.manage') }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.*, uo.name AS opened_by_name, uc.name AS closed_by_name FROM cash_sessions s
           LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by WHERE s.id = $1`,
        [id],
      );
      if (!rows[0]) throw notFound();
      return { session: rows[0], summary: rows[0].summary ?? (await cashSummary(tx, rows[0])) };
    });
  });
}
