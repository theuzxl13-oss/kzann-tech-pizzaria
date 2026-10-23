import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTenant } from '../db.js';
import { PAYMENT_LABELS, type PaymentMethod } from '../domain/orderFlow.js';
import { AppError, notFound } from '../lib/errors.js';
import { loadPublicMenu } from '../services/catalog.js';
import { buildQuote, createOrder, getPublicOrder, orderSchema, quoteSchema } from '../services/orders.js';
import { findTenantBySlug, gatewayEnabled, getHours, getSettings } from '../services/tenants.js';
import { resolveOpenStatus } from '../domain/hours.js';

const slugParam = z.object({ slug: z.string().max(60) });

export async function publicRoutes(f: FastifyInstance, app: AppContext) {
  /** Cardápio completo + dados da loja para a página pública. */
  f.get('/api/public/:slug', async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const tenant = await findTenantBySlug(app.db, slug);
    const data = await withTenant(app.db, tenant.id, async (tx) => {
      const s = await getSettings(tx);
      const hours = await getHours(tx);
      const menu = await loadPublicMenu(tx);
      const zones = (
        await tx.query(
          'SELECT id, name, fee_cents, neighborhoods, min_order_cents, eta_minutes FROM delivery_zones WHERE active ORDER BY sort, name',
        )
      ).rows;
      const hasGateway = await gatewayEnabled(tx);
      const methods: PaymentMethod[] = [];
      if (s.accept_cash) methods.push('cash');
      if (s.accept_card_on_delivery) methods.push('card_on_delivery');
      if (s.accept_pix_offline && s.pix_key) methods.push('pix_offline');
      if (s.accept_pix_online && hasGateway) methods.push('pix_online');
      return {
        tenant: {
          slug: tenant.slug,
          name: tenant.name,
          description: s.description,
          address: s.address,
          whatsapp_phone: s.whatsapp_phone,
          logo_url: s.logo_url,
          cover_url: s.cover_url,
          primary_color: s.primary_color,
          secondary_color: s.secondary_color,
          timezone: s.timezone,
        },
        status: {
          open: resolveOpenStatus(s.manual_status, hours, s.timezone),
          manual_status: s.manual_status,
          hours,
        },
        ordering: {
          delivery_enabled: s.delivery_enabled,
          pickup_enabled: s.pickup_enabled,
          delivery_eta_minutes: s.delivery_eta_minutes,
          pickup_eta_minutes: s.pickup_eta_minutes,
          min_order_cents: s.min_order_cents,
          half_half_pricing: s.half_half_pricing,
          payment_methods: methods.map((m) => ({ id: m, label: PAYMENT_LABELS[m] })),
          pix_key: s.accept_pix_offline ? s.pix_key : null,
          pix_key_holder: s.accept_pix_offline ? s.pix_key_holder : null,
        },
        zones,
        menu,
      };
    });
    reply.header('Cache-Control', 'no-store');
    return data;
  });

  /** Simula o total do carrinho no servidor (preços oficiais, taxa e cupom). */
  f.post('/api/public/:slug/quote', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { slug } = slugParam.parse(req.params);
    const body = quoteSchema.parse(req.body);
    const tenant = await findTenantBySlug(app.db, slug);
    return withTenant(app.db, tenant.id, async (tx) => buildQuote(tx, await getSettings(tx), body, { strictCoupon: false }));
  });

  // KZ-03: o limite só por IP bloqueava clientes legítimos que compartilham IP (operadora móvel/CGNAT,
  // ou todos os clientes quando o proxy não está configurado). Agora há dois limites:
  // - por IP + telefone (protege contra repetição do mesmo cliente);
  // - teto por IP bem mais alto (protege contra abuso trocando de telefone).
  // createRateLimit (e não rateLimit) porque o plugin ignora um segundo limitador na mesma requisição.
  const orderLimitPerIp = f.createRateLimit({ max: 60, timeWindow: '10 minutes', keyGenerator: (req) => `orders-ip:${req.ip}` });
  const phoneOf = (req: FastifyRequest) => String((req.body as any)?.customer?.phone ?? '').replace(/\D/g, '').slice(0, 15);
  f.post('/api/public/:slug/orders', {
    onRequest: async (req) => {
      const r = await orderLimitPerIp(req);
      if (!r.isAllowed && r.isExceeded) throw new AppError(429, 'rate_limited', 'Muitos pedidos a partir desta conexão. Aguarde alguns minutos.');
    },
    config: {
      rateLimit: { max: 6, timeWindow: '10 minutes', hook: 'preHandler', keyGenerator: (req: FastifyRequest) => `orders-phone:${req.ip}:${phoneOf(req)}` },
    },
  }, async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const body = orderSchema.parse(req.body);
    const tenant = await findTenantBySlug(app.db, slug);
    const result = await createOrder(app, tenant, body);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  const tokenParams = z.object({ slug: z.string().max(60), token: z.string().min(20).max(64) });

  f.get('/api/public/:slug/orders/:token', async (req, reply) => {
    const { slug, token } = tokenParams.parse(req.params);
    const tenant = await findTenantBySlug(app.db, slug);
    reply.header('Cache-Control', 'no-store');
    return withTenant(app.db, tenant.id, (tx) => getPublicOrder(tx, token));
  });

  /** Acompanhamento em tempo real do pedido pelo cliente. */
  f.get('/api/public/:slug/orders/:token/events', async (req, reply) => {
    const { slug, token } = tokenParams.parse(req.params);
    const tenant = await findTenantBySlug(app.db, slug);
    const { rows } = await withTenant(app.db, tenant.id, (tx) =>
      tx.query('SELECT id FROM orders WHERE public_token = $1', [token]),
    );
    if (!rows[0]) throw notFound('Pedido não encontrado');
    const orderId = rows[0].id;
    app.hub.stream(req, reply, (e) => e.tenantId === tenant.id && e.orderId === orderId, (e) => ({ status: e.status }));
  });

  /** Manifesto PWA por pizzaria: o cliente pode "instalar" o cardápio da sua pizzaria. */
  f.get('/api/public/:slug/manifest.webmanifest', async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const tenant = await findTenantBySlug(app.db, slug);
    const s = await withTenant(app.db, tenant.id, getSettings);
    const icons = s.logo_url
      ? [{ src: s.logo_url, sizes: '512x512', purpose: 'any' }]
      : [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ];
    reply.type('application/manifest+json');
    return {
      name: tenant.name,
      short_name: tenant.name.slice(0, 12),
      start_url: `/p/${tenant.slug}`,
      scope: `/p/${tenant.slug}`,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: s.primary_color,
      icons,
    };
  });
}
