import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTenant } from '../db.js';
import { AppError, notFound } from '../lib/errors.js';
import { verifyMercadoPagoSignature } from '../payments/mercadopago.js';
import { getGatewayClient, syncOnlinePayment } from '../services/orders.js';

export async function webhookRoutes(f: FastifyInstance, app: AppContext) {
  /**
   * Webhook do Mercado Pago — uma URL por estabelecimento.
   * 1) valida assinatura HMAC (x-signature) com o segredo do estabelecimento;
   * 2) registra o evento (idempotência);
   * 3) consulta o pagamento na API do gateway e só então atualiza o pedido.
   */
  f.post('/api/webhooks/mercadopago/:tenantId', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(req.params);
    const query = req.query as Record<string, string | undefined>;
    const body = (req.body ?? {}) as { type?: string; action?: string; data?: { id?: string | number } };
    const dataId = query['data.id'] ?? (body.data?.id !== undefined ? String(body.data.id) : undefined);
    const type = query.type ?? body.type;

    const tenant = (await app.db.query('SELECT id FROM tenants WHERE id = $1', [tenantId])).rows[0];
    if (!tenant) throw notFound();
    const gw = await withTenant(app.db, tenantId, (tx) => getGatewayClient(app, tx));
    if (!gw) throw notFound();

    const valid = verifyMercadoPagoSignature({
      secret: gw.webhookSecret,
      signatureHeader: req.headers['x-signature'] as string | undefined,
      requestId: req.headers['x-request-id'] as string | undefined,
      dataId,
    });
    if (!valid) {
      req.log.warn({ tenantId }, 'webhook com assinatura inválida');
      throw new AppError(401, 'invalid_signature', 'Assinatura inválida');
    }

    const eventKey = `${type}:${dataId}:${body.action ?? ''}:${req.headers['x-request-id'] ?? ''}`;
    const fresh = await withTenant(app.db, tenantId, async (tx) => {
      const r = await tx.query(
        `INSERT INTO webhook_events (tenant_id, provider, event_key, payload) VALUES ($1, 'mercadopago', $2, $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [tenantId, eventKey, JSON.stringify({ query, body })],
      );
      return r.rows.length > 0;
    });

    if (fresh && type === 'payment' && dataId) {
      try {
        await syncOnlinePayment(app, tenantId, dataId);
      } catch (err) {
        // Falha ao consultar o gateway: responde 500 para o Mercado Pago reenviar.
        await withTenant(app.db, tenantId, (tx) =>
          tx.query("DELETE FROM webhook_events WHERE tenant_id = $1 AND provider = 'mercadopago' AND event_key = $2", [tenantId, eventKey]),
        );
        req.log.error({ err }, 'falha ao sincronizar pagamento');
        return reply.code(500).send({ ok: false });
      }
    }
    return { ok: true };
  });
}
