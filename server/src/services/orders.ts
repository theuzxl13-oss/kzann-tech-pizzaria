import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTenant, type Tx } from '../db.js';
import {
  canTransition,
  permissionFor,
  STATUS_LABELS,
  STATUS_TIMESTAMP,
  type Fulfillment,
  type OrderStatus,
  type PaymentMethod,
} from '../domain/orderFlow.js';
import { couponDiscount, formatBRL, priceItem, PricingError, type PricedItem } from '../domain/pricing.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { can, type Role } from '../lib/permissions.js';
import { GatewayError, MercadoPagoClient } from '../payments/mercadopago.js';
import { notify } from '../realtime.js';
import { loadCatalog } from './catalog.js';
import { gatewayEnabled, getSettings, isOpenNow, type TenantRow } from './tenants.js';

const id = z.string().uuid();
const cartItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pizza'),
    size_id: id,
    flavor_ids: z.array(id).min(1).max(4),
    crust_id: id.nullish(),
    addon_ids: z.array(id).max(20).optional(),
    quantity: z.number().int().min(1).max(99),
    notes: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('product'),
    product_id: id,
    addon_ids: z.array(id).max(20).optional(),
    quantity: z.number().int().min(1).max(99),
    notes: z.string().max(200).optional(),
  }),
]);

export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length >= 10 && v.length <= 13, 'Telefone inválido');

export const quoteSchema = z.object({
  items: z.array(cartItem).min(1, 'Carrinho vazio').max(50),
  fulfillment: z.enum(['delivery', 'pickup']),
  delivery_zone_id: id.nullish(),
  neighborhood: z.string().trim().max(80).nullish(),
  coupon_code: z.string().trim().toUpperCase().max(30).nullish(),
});

export const orderSchema = quoteSchema.extend({
  customer: z.object({
    name: z.string().trim().min(2, 'Informe seu nome').max(80),
    phone: phoneSchema,
    email: z.string().trim().email('E-mail inválido').max(120).optional().or(z.literal('')),
  }),
  address: z
    .object({
      street: z.string().trim().min(2).max(120),
      number: z.string().trim().min(1).max(20),
      complement: z.string().trim().max(80).optional().default(''),
      reference: z.string().trim().max(120).optional().default(''),
    })
    .nullish(),
  payment_method: z.enum(['cash', 'card_on_delivery', 'pix_offline', 'pix_online']),
  change_for_cents: z.number().int().min(0).max(1_000_000).nullish(),
  notes: z.string().trim().max(500).optional().default(''),
});

export type QuoteInput = z.infer<typeof quoteSchema>;
export type OrderInput = z.infer<typeof orderSchema>;

export interface Quote {
  items: PricedItem[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  min_order_cents: number;
  coupon: { id: string; code: string; type: string } | null;
  coupon_error: string | null;
  zone: { id: string; name: string; eta_minutes: number | null } | null;
  eta_minutes: number;
}

/** Calcula o pedido inteiramente no servidor (preços, taxa, cupom). */
export async function buildQuote(tx: Tx, settings: any, input: QuoteInput, opts: { strictCoupon: boolean; lockCoupon?: boolean }): Promise<Quote> {
  const catalog = await loadCatalog(tx, settings.half_half_pricing);
  let items: PricedItem[];
  try {
    items = input.items.map((item) => priceItem(catalog, item));
  } catch (err) {
    if (err instanceof PricingError) throw badRequest(err.code, err.message);
    throw err;
  }
  const subtotal = items.reduce((s, i) => s + i.total_cents, 0);

  let fee = 0;
  let zone: Quote['zone'] = null;
  let minOrder = settings.min_order_cents as number;
  let eta = settings.pickup_eta_minutes as number;
  if (input.fulfillment === 'delivery') {
    if (!settings.delivery_enabled) throw badRequest('delivery_disabled', 'Esta pizzaria não está fazendo entregas no momento');
    eta = settings.delivery_eta_minutes;
    if (input.delivery_zone_id) {
      const { rows } = await tx.query('SELECT * FROM delivery_zones WHERE id = $1 AND active', [input.delivery_zone_id]);
      const z0 = rows[0];
      if (!z0) throw badRequest('zone_unavailable', 'Região de entrega indisponível');
      if (z0.neighborhoods.length && !z0.neighborhoods.includes(input.neighborhood ?? '')) {
        throw badRequest('neighborhood_mismatch', 'Bairro não atendido por esta região');
      }
      fee = z0.fee_cents;
      zone = { id: z0.id, name: z0.name, eta_minutes: z0.eta_minutes };
      if (z0.eta_minutes) eta = z0.eta_minutes;
      if (z0.min_order_cents !== null) minOrder = Math.max(minOrder, z0.min_order_cents);
    }
  } else if (!settings.pickup_enabled) {
    throw badRequest('pickup_disabled', 'Esta pizzaria não está aceitando retirada no momento');
  }

  let discount = 0;
  let coupon: Quote['coupon'] = null;
  let couponError: string | null = null;
  if (input.coupon_code) {
    const { rows } = await tx.query(
      `SELECT * FROM coupons WHERE code = $1 ${opts.lockCoupon ? 'FOR UPDATE' : ''}`,
      [input.coupon_code],
    );
    try {
      if (!rows[0]) throw new PricingError('coupon_invalid', 'Cupom inválido');
      discount = couponDiscount(rows[0], subtotal, fee);
      coupon = { id: rows[0].id, code: rows[0].code, type: rows[0].type };
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
      if (opts.strictCoupon) throw badRequest(err.code, err.message);
      couponError = err.message;
    }
  }

  return {
    items,
    subtotal_cents: subtotal,
    delivery_fee_cents: fee,
    discount_cents: discount,
    total_cents: Math.max(0, subtotal + fee - discount),
    min_order_cents: minOrder,
    coupon,
    coupon_error: couponError,
    zone,
    eta_minutes: eta,
  };
}

function methodEnabled(settings: any, method: PaymentMethod, hasGateway: boolean): boolean {
  switch (method) {
    case 'cash':
      return settings.accept_cash;
    case 'card_on_delivery':
      return settings.accept_card_on_delivery;
    case 'pix_offline':
      return settings.accept_pix_offline && !!settings.pix_key;
    case 'pix_online':
      return settings.accept_pix_online && hasGateway;
  }
}

export async function createOrder(app: AppContext, tenant: TenantRow, input: OrderInput) {
  if (input.fulfillment === 'delivery') {
    if (!input.address) throw badRequest('address_required', 'Informe o endereço de entrega');
    if (!input.delivery_zone_id) throw badRequest('zone_required', 'Selecione o bairro/região de entrega');
  }
  if (input.payment_method === 'pix_online' && !input.customer.email) {
    throw badRequest('email_required', 'Informe um e-mail para gerar o Pix');
  }

  const created = await withTenant(app.db, tenant.id, async (tx) => {
    const settings = await getSettings(tx);
    if (!(await isOpenNow(tx, settings))) throw conflict('closed', 'A pizzaria está fechada no momento');
    const hasGateway = await gatewayEnabled(tx);
    if (!methodEnabled(settings, input.payment_method, hasGateway)) {
      throw badRequest('payment_method_unavailable', 'Forma de pagamento indisponível');
    }
    const quote = await buildQuote(tx, settings, input, { strictCoupon: true, lockCoupon: true });
    if (quote.subtotal_cents < quote.min_order_cents) {
      throw badRequest('min_order', `Pedido mínimo de ${formatBRL(quote.min_order_cents)}`);
    }
    if (input.payment_method === 'cash' && input.change_for_cents && input.change_for_cents < quote.total_cents) {
      throw badRequest('invalid_change', 'O valor para troco deve ser maior que o total');
    }

    const { rows: counter } = await tx.query(
      'UPDATE tenant_settings SET order_counter = order_counter + 1 RETURNING order_counter',
    );
    const number = counter[0].order_counter as number;
    const phone = input.customer.phone;
    const address =
      input.fulfillment === 'delivery' && input.address
        ? { ...input.address, neighborhood: input.neighborhood ?? quote.zone?.name ?? '', zone: quote.zone?.name ?? '' }
        : null;

    const { rows: cust } = await tx.query(
      `INSERT INTO customers (tenant_id, phone, name, last_address, orders_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (tenant_id, phone) DO UPDATE
         SET name = EXCLUDED.name, last_address = COALESCE(EXCLUDED.last_address, customers.last_address),
             orders_count = customers.orders_count + 1, updated_at = now()
       RETURNING id`,
      [tenant.id, phone, input.customer.name, address ? JSON.stringify(address) : null],
    );

    const online = input.payment_method === 'pix_online';
    const status: OrderStatus = online ? 'awaiting_payment' : settings.auto_accept ? 'accepted' : 'pending';
    const token = randomToken(24);
    const { rows: orderRows } = await tx.query(
      `INSERT INTO orders (tenant_id, number, public_token, customer_id, customer_name, customer_phone, customer_email,
         fulfillment, address, delivery_zone_id, status, payment_method, change_for_cents, subtotal_cents,
         delivery_fee_cents, discount_cents, total_cents, coupon_id, coupon_code, notes, eta_minutes, accepted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id, number, public_token, status, total_cents`,
      [
        tenant.id, number, token, cust[0].id, input.customer.name, phone, input.customer.email || null,
        input.fulfillment, address ? JSON.stringify(address) : null, quote.zone?.id ?? null, status,
        input.payment_method, input.payment_method === 'cash' ? input.change_for_cents ?? null : null,
        quote.subtotal_cents, quote.delivery_fee_cents, quote.discount_cents, quote.total_cents,
        quote.coupon?.id ?? null, quote.coupon?.code ?? null, input.notes, quote.eta_minutes,
        status === 'accepted' ? new Date() : null,
      ],
    );
    const order = orderRows[0];
    for (const item of quote.items) {
      await tx.query(
        `INSERT INTO order_items (tenant_id, order_id, kind, name, description, details, quantity, unit_price_cents, total_cents, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tenant.id, order.id, item.kind, item.name, item.description, JSON.stringify(item.details), item.quantity,
          item.unit_price_cents, item.total_cents, item.notes],
      );
    }
    if (quote.coupon) await tx.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = $1', [quote.coupon.id]);
    await tx.query(
      'INSERT INTO order_events (tenant_id, order_id, type, to_status, message) VALUES ($1, $2, $3, $4, $5)',
      [tenant.id, order.id, 'created', status, 'Pedido recebido pelo cardápio online'],
    );
    if (!online) await notify(tx, { tenantId: tenant.id, orderId: order.id, type: 'order.created', status, number });
    return { order, settings };
  });

  if (input.payment_method === 'pix_online') {
    try {
      await createPixCharge(app, tenant, created.order.id);
    } catch (err) {
      await cancelOrderInternal(app, tenant.id, created.order.id, 'Não foi possível gerar o Pix', 'failed');
      app.log.error({ err, orderId: created.order.id }, 'falha ao criar cobrança Pix');
      throw new AppError(502, 'payment_gateway_error', 'Não foi possível gerar o Pix agora. Tente outra forma de pagamento.');
    }
  }
  return { id: created.order.id, number: created.order.number, token: created.order.public_token };
}

export async function getGatewayClient(app: AppContext, tx: Tx) {
  const { rows } = await tx.query("SELECT * FROM payment_gateways WHERE provider = 'mercadopago' AND enabled");
  const gw = rows[0];
  if (!gw?.access_token_enc || !gw?.webhook_secret_enc) return null;
  return {
    client: new MercadoPagoClient(app.secrets.decrypt(gw.access_token_enc), app.cfg.MERCADOPAGO_API_URL, app.fetchImpl),
    webhookSecret: app.secrets.decrypt(gw.webhook_secret_enc),
  };
}

async function createPixCharge(app: AppContext, tenant: TenantRow, orderId: string) {
  const { order, gw } = await withTenant(app.db, tenant.id, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return { order: rows[0], gw: await getGatewayClient(app, tx) };
  });
  if (!gw) throw new GatewayError('gateway não configurado');
  const expiresAt = new Date(Date.now() + app.cfg.PIX_EXPIRATION_MINUTES * 60_000);
  const charge = await gw.client.createPixPayment({
    orderId,
    amountCents: order.total_cents,
    description: `${tenant.name} — Pedido #${order.number}`,
    payerEmail: order.customer_email,
    payerName: order.customer_name,
    notificationUrl: `${app.cfg.PUBLIC_BASE_URL}/api/webhooks/mercadopago/${tenant.id}`,
    expiresAt,
  });
  await withTenant(app.db, tenant.id, (tx) =>
    tx.query(
      `INSERT INTO payments (tenant_id, order_id, provider, provider_payment_id, status, amount_cents, qr_code, qr_code_base64, ticket_url, expires_at)
       VALUES ($1, $2, 'mercadopago', $3, $4, $5, $6, $7, $8, $9)`,
      [tenant.id, orderId, charge.providerPaymentId, charge.status, order.total_cents, charge.qrCode, charge.qrCodeBase64,
        charge.ticketUrl, charge.expiresAt],
    ),
  );
}

async function setStatus(tx: Tx, tenantId: string, order: any, to: OrderStatus, userId: string | null, message?: string) {
  const col = STATUS_TIMESTAMP[to];
  await tx.query(
    `UPDATE orders SET status = $2${col ? `, ${col} = COALESCE(${col}, now())` : ''}${to === 'cancelled' ? ', cancel_reason = $3' : ''} WHERE id = $1`,
    to === 'cancelled' ? [order.id, to, message ?? null] : [order.id, to],
  );
  await tx.query(
    'INSERT INTO order_events (tenant_id, order_id, type, from_status, to_status, user_id, message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [tenantId, order.id, 'status', order.status, to, userId, message ?? STATUS_LABELS[to]],
  );
}

/** Libera cupom e marca pagamento após cancelamento. */
async function afterCancel(tx: Tx, order: any) {
  if (order.coupon_id) {
    await tx.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1', [order.coupon_id]);
  }
}

/** Cancela pedido que ainda aguarda pagamento online (falha ao gerar Pix ou Pix vencido). */
async function cancelOrderInternal(app: AppContext, tenantId: string, orderId: string, reason: string, paymentStatus: string) {
  await withTenant(app.db, tenantId, async (tx) => {
    const { rows } = await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order || order.status !== 'awaiting_payment') return;
    await setStatus(tx, tenantId, order, 'cancelled', null, reason);
    await tx.query('UPDATE orders SET payment_status = $2 WHERE id = $1', [orderId, paymentStatus]);
    await afterCancel(tx, order);
    await notify(tx, { tenantId, orderId, type: 'order.updated', status: 'cancelled', number: order.number });
  });
}

export async function changeStatus(
  app: AppContext,
  actor: { tenantId: string; userId: string; role: Role },
  orderId: string,
  to: OrderStatus,
  reason?: string,
) {
  if (!can(actor.role, permissionFor(to))) throw forbidden();
  const refund = await withTenant(
    app.db,
    actor.tenantId,
    async (tx) => {
      const { rows } = await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const order = rows[0];
      if (!order) throw notFound('Pedido não encontrado');
      if (!canTransition(order.status, to, order.fulfillment as Fulfillment)) {
        throw conflict('invalid_transition', `Não é possível mudar de "${STATUS_LABELS[order.status as OrderStatus]}" para "${STATUS_LABELS[to]}"`);
      }
      if (to === 'cancelled' && !reason?.trim()) throw badRequest('reason_required', 'Informe o motivo do cancelamento');
      await setStatus(tx, actor.tenantId, order, to, actor.userId, to === 'cancelled' ? reason!.trim() : undefined);

      let needsRefund = false;
      if (to === 'cancelled') {
        await afterCancel(tx, order);
        if (order.payment_method === 'pix_online' && order.payment_status === 'paid') {
          needsRefund = true;
          await tx.query("UPDATE orders SET payment_status = 'refund_pending' WHERE id = $1", [orderId]);
        } else if (order.payment_status === 'pending') {
          await tx.query("UPDATE orders SET payment_status = 'cancelled' WHERE id = $1", [orderId]);
        }
      }
      // Pagamento na entrega/retirada: concluir o pedido registra o recebimento.
      if (to === 'completed' && order.payment_status === 'pending' && order.payment_method !== 'pix_online') {
        await tx.query("UPDATE orders SET payment_status = 'paid', paid_at = now() WHERE id = $1", [orderId]);
        await tx.query(
          "INSERT INTO order_events (tenant_id, order_id, type, user_id, message) VALUES ($1, $2, 'payment', $3, 'Pagamento recebido na conclusão')",
          [actor.tenantId, orderId, actor.userId],
        );
      }
      await notify(tx, { tenantId: actor.tenantId, orderId, type: 'order.updated', status: to, number: order.number });
      return needsRefund;
    },
    actor.userId,
  );

  if (refund) await refundOnlinePayment(app, actor.tenantId, orderId, actor.userId);
}

async function refundOnlinePayment(app: AppContext, tenantId: string, orderId: string, userId: string | null) {
  try {
    const { pay, gw } = await withTenant(app.db, tenantId, async (tx) => {
      const { rows } = await tx.query("SELECT * FROM payments WHERE order_id = $1 AND status = 'approved' LIMIT 1", [orderId]);
      return { pay: rows[0], gw: await getGatewayClient(app, tx) };
    });
    if (!pay || !gw) throw new Error('pagamento ou gateway ausente');
    await gw.client.refund(pay.provider_payment_id);
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.query("UPDATE orders SET payment_status = 'refunded' WHERE id = $1", [orderId]);
      await tx.query("UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1", [pay.id]);
      await tx.query(
        "INSERT INTO order_events (tenant_id, order_id, type, user_id, message) VALUES ($1, $2, 'payment', $3, 'Estorno do Pix solicitado ao Mercado Pago')",
        [tenantId, orderId, userId],
      );
    });
  } catch (err) {
    app.log.error({ err, orderId }, 'falha no estorno');
    await withTenant(app.db, tenantId, (tx) =>
      tx.query(
        "INSERT INTO order_events (tenant_id, order_id, type, user_id, message) VALUES ($1, $2, 'payment', $3, 'Estorno automático falhou — realize o estorno pelo painel do Mercado Pago')",
        [tenantId, orderId, userId],
      ),
    );
  }
}

/** Confirmação MANUAL de recebimento (dinheiro, cartão na entrega, Pix pela chave). */
export async function confirmManualPayment(app: AppContext, actor: { tenantId: string; userId: string }, orderId: string) {
  await withTenant(
    app.db,
    actor.tenantId,
    async (tx) => {
      const { rows } = await tx.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const order = rows[0];
      if (!order) throw notFound('Pedido não encontrado');
      if (order.payment_method === 'pix_online') {
        throw badRequest('online_payment', 'Pagamentos online são confirmados automaticamente pelo gateway');
      }
      if (order.payment_status !== 'pending' || order.status === 'cancelled') {
        throw conflict('payment_not_pending', 'Este pedido não está com pagamento pendente');
      }
      await tx.query("UPDATE orders SET payment_status = 'paid', paid_at = now() WHERE id = $1", [orderId]);
      await tx.query(
        "INSERT INTO order_events (tenant_id, order_id, type, user_id, message) VALUES ($1, $2, 'payment', $3, 'Pagamento confirmado pela equipe')",
        [actor.tenantId, orderId, actor.userId],
      );
      await notify(tx, { tenantId: actor.tenantId, orderId, type: 'order.updated', status: order.status, number: order.number });
    },
    actor.userId,
  );
}

/**
 * Sincroniza o status de um pagamento online consultando a API do gateway.
 * Chamado pelo webhook (após validar a assinatura) e pela reconciliação periódica.
 */
export async function syncOnlinePayment(app: AppContext, tenantId: string, providerPaymentId: string) {
  const gw = await withTenant(app.db, tenantId, (tx) => getGatewayClient(app, tx));
  if (!gw) return;
  const remote = await gw.client.getPayment(providerPaymentId);

  await withTenant(app.db, tenantId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT p.*, o.status AS order_status, o.total_cents, o.number, o.fulfillment, o.coupon_id
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.provider = 'mercadopago' AND p.provider_payment_id = $1 FOR UPDATE OF p, o`,
      [remote.id],
    );
    const pay = rows[0];
    if (!pay) return;
    if (remote.externalReference !== pay.order_id) {
      app.log.warn({ providerPaymentId }, 'external_reference não confere — ignorado');
      return;
    }
    await tx.query('UPDATE payments SET status = $2, updated_at = now() WHERE id = $1', [pay.id, remote.status]);

    if (remote.status === 'approved' && pay.order_status === 'awaiting_payment') {
      if (remote.amountCents !== pay.total_cents) {
        app.log.error({ providerPaymentId }, 'valor pago difere do total do pedido');
        await tx.query(
          "INSERT INTO order_events (tenant_id, order_id, type, message) VALUES ($1, $2, 'payment', 'Valor recebido difere do total — verificar manualmente')",
          [tenantId, pay.order_id],
        );
        return;
      }
      const settings = await getSettings(tx);
      const next: OrderStatus = settings.auto_accept ? 'accepted' : 'pending';
      await tx.query(
        `UPDATE orders SET status = $2, payment_status = 'paid', paid_at = now()${next === 'accepted' ? ', accepted_at = now()' : ''} WHERE id = $1`,
        [pay.order_id, next],
      );
      await tx.query(
        "INSERT INTO order_events (tenant_id, order_id, type, from_status, to_status, message) VALUES ($1, $2, 'payment', 'awaiting_payment', $3, 'Pix confirmado pelo Mercado Pago')",
        [tenantId, pay.order_id, next],
      );
      await notify(tx, { tenantId, orderId: pay.order_id, type: 'order.created', status: next, number: pay.number });
    } else if (['rejected', 'cancelled', 'expired'].includes(remote.status) && pay.order_status === 'awaiting_payment') {
      await setStatus(tx, tenantId, { id: pay.order_id, status: pay.order_status }, 'cancelled', null, 'Pix não pago dentro do prazo');
      await tx.query("UPDATE orders SET payment_status = 'failed' WHERE id = $1", [pay.order_id]);
      await afterCancel(tx, pay);
      await notify(tx, { tenantId, orderId: pay.order_id, type: 'order.updated', status: 'cancelled', number: pay.number });
    } else if (['refunded', 'charged_back'].includes(remote.status)) {
      await tx.query("UPDATE orders SET payment_status = 'refunded' WHERE id = $1", [pay.order_id]);
    }
  });
}

/** Reconciliação: pedidos aguardando Pix com cobrança vencida são consultados no gateway. */
export async function reconcilePendingPix(app: AppContext) {
  const { rows: tenants } = await app.db.query("SELECT id FROM tenants WHERE status = 'active'");
  for (const t of tenants) {
    const stale = await withTenant(app.db, t.id, async (tx) => {
      const { rows } = await tx.query(
        `SELECT p.provider_payment_id, p.order_id, p.expires_at FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE o.status = 'awaiting_payment' AND (p.expires_at IS NULL OR p.expires_at < now() - interval '2 minutes'
                OR p.updated_at < now() - interval '5 minutes')`,
      );
      return rows;
    });
    for (const p of stale) {
      try {
        await syncOnlinePayment(app, t.id, p.provider_payment_id);
        // Gateway ainda "pending" bem depois do vencimento: cancela localmente.
        if (p.expires_at && new Date(p.expires_at).getTime() < Date.now() - 30 * 60_000) {
          await cancelOrderInternal(app, t.id, p.order_id, 'Pix não pago dentro do prazo', 'failed');
        }
      } catch (err) {
        app.log.warn({ err, tenantId: t.id }, 'reconciliação Pix falhou');
      }
    }
  }
}

/** Detalhes completos de um pedido (painel). */
export async function getOrderDetail(tx: Tx, orderId: string) {
  const { rows } = await tx.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!rows[0]) throw notFound('Pedido não encontrado');
  const [items, events, payments] = await Promise.all([
    tx.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]),
    tx.query(
      `SELECT e.*, u.name AS user_name FROM order_events e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.order_id = $1 ORDER BY e.id`,
      [orderId],
    ),
    tx.query('SELECT id, provider, provider_payment_id, status, amount_cents, expires_at, created_at FROM payments WHERE order_id = $1', [orderId]),
  ]);
  return { ...rows[0], items: items.rows, events: events.rows, payments: payments.rows };
}

/** Visão pública (cliente) do pedido via token secreto. */
export async function getPublicOrder(tx: Tx, token: string) {
  const { rows } = await tx.query('SELECT * FROM orders WHERE public_token = $1', [token]);
  const o = rows[0];
  if (!o) throw notFound('Pedido não encontrado');
  const items = await tx.query(
    'SELECT name, description, quantity, unit_price_cents, total_cents, notes FROM order_items WHERE order_id = $1 ORDER BY id',
    [o.id],
  );
  const pay = await tx.query(
    "SELECT status, qr_code, qr_code_base64, ticket_url, expires_at FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1",
    [o.id],
  );
  const events = await tx.query(
    "SELECT to_status, created_at FROM order_events WHERE order_id = $1 AND to_status IS NOT NULL ORDER BY id",
    [o.id],
  );
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    fulfillment: o.fulfillment,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone,
    address: o.address,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    change_for_cents: o.change_for_cents,
    subtotal_cents: o.subtotal_cents,
    delivery_fee_cents: o.delivery_fee_cents,
    discount_cents: o.discount_cents,
    total_cents: o.total_cents,
    coupon_code: o.coupon_code,
    notes: o.notes,
    eta_minutes: o.eta_minutes,
    cancel_reason: o.cancel_reason,
    created_at: o.created_at,
    items: items.rows,
    timeline: events.rows,
    pix: o.payment_method === 'pix_online' ? pay.rows[0] ?? null : null,
  };
}
