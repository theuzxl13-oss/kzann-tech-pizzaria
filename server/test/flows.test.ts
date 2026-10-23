import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { Client, expectOk, startTestApp, startTestDb } from './helpers.js';

/**
 * Testes de ponta a ponta da API contra um PostgreSQL real, com o papel de aplicação
 * sem privilégios (RLS ativo). O gateway Mercado Pago é substituído por um servidor
 * fake APENAS nos testes, para validar o fluxo de webhook sem cobrar ninguém.
 */

let db: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

// ── Gateway fake (somente teste) ──
const mpPayments = new Map<string, { id: number; status: string; transaction_amount: number; external_reference: string }>();
let mpSeq = 9000;
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/v1/payments') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    assert.equal((init.headers as any).Authorization, 'Bearer TEST-access-token-1234567890');
    assert.ok((init.headers as any)['X-Idempotency-Key']);
    const p = { id: ++mpSeq, status: 'pending', transaction_amount: body.transaction_amount, external_reference: body.external_reference };
    mpPayments.set(String(p.id), p);
    return json(201, {
      ...p,
      date_of_expiration: body.date_of_expiration,
      point_of_interaction: { transaction_data: { qr_code: '00020126PIXCOPIAECOLA', qr_code_base64: 'iVBORw0KGgo=', ticket_url: 'https://mp.test/t' } },
    });
  }
  const m = u.match(/\/v1\/payments\/(\d+)$/);
  if (m) {
    const p = mpPayments.get(m[1]);
    return p ? json(200, p) : json(404, { message: 'not found' });
  }
  return json(404, { message: 'rota fake inexistente' });
}) as typeof fetch;

const owner = { a: null as unknown as Client, b: null as unknown as Client };
const ids: Record<string, string> = {};

before(async () => {
  db = await startTestDb();
  ({ app } = await startTestApp(db.appUrl, fakeFetch, { ssePingMs: 300 }));
  owner.a = new Client(app);
  owner.b = new Client(app);
});

after(async () => {
  await app?.close();
  await db?.stop();
});

describe('cadastro, login e sessão', () => {
  test('cadastra duas pizzarias independentes', async () => {
    const r = await owner.a.post('/api/auth/signup', {
      pizzeria_name: 'Pizzaria Bella', slug: 'bella', name: 'Ana Dona', email: 'ana@bella.test', password: 'senhaForte1',
      whatsapp_phone: '(11) 98888-7777',
    });
    ids.tenantA = expectOk(r, 201).tenant.id;
    const r2 = await owner.b.post('/api/auth/signup', {
      pizzeria_name: 'Forno do Zé', slug: 'forno-do-ze', name: 'José', email: 'ze@forno.test', password: 'outraSenha9',
    });
    ids.tenantB = expectOk(r2, 201).tenant.id;
    const dup = await new Client(app).post('/api/auth/signup', {
      pizzeria_name: 'Copia', slug: 'bella', name: 'Xis', email: 'x@x.test', password: 'senhaForte1',
    });
    assert.equal(dup.status, 409);
  });

  test('login, /me e senha errada', async () => {
    const c = new Client(app);
    assert.equal((await c.post('/api/auth/login', { email: 'ana@bella.test', password: 'errada123' })).status, 401);
    expectOk(await c.post('/api/auth/login', { email: 'ANA@bella.test', password: 'senhaForte1' }));
    const me = expectOk(await c.get('/api/auth/me'));
    assert.equal(me.tenant.slug, 'bella');
    assert.equal(me.role, 'owner');
  });

  test('bloqueia requisição sem cabeçalho CSRF e sem sessão', async () => {
    const r = await owner.a.req('POST', '/api/admin/menu/categories', { name: 'X', kind: 'product' }, { 'x-kzann-csrf': '' });
    assert.equal(r.status, 403);
    const anon = await new Client(app).get('/api/admin/orders/board');
    assert.equal(anon.status, 401);
  });
});

describe('cardápio e configurações', () => {
  test('monta o cardápio da pizzaria A', async () => {
    const a = owner.a;
    const cats = expectOk(await a.get('/api/admin/menu/categories'));
    const sizes = expectOk(await a.get('/api/admin/menu/sizes'));
    ids.catPizza = cats.find((c: any) => c.kind === 'pizza').id;
    ids.catDrinks = cats.find((c: any) => c.kind === 'product').id;
    ids.sizeG = sizes.find((s: any) => s.name === 'Grande').id;
    ids.sizeBroto = sizes.find((s: any) => s.name === 'Broto').id;

    ids.calabresa = expectOk(await a.post('/api/admin/menu/flavors', {
      category_id: ids.catPizza, name: 'Calabresa', description: 'Calabresa, cebola e azeitona',
      prices: { [ids.sizeG]: 5490, [ids.sizeBroto]: 2990 },
    }), 201).id;
    const frango = expectOk(await a.post('/api/admin/menu/flavors', {
      category_id: ids.catPizza, name: 'Frango com Catupiry', prices: { [ids.sizeG]: 6290 },
    }), 201);
    ids.frango = frango.id;
    assert.equal(frango.prices[ids.sizeG], 6290);
    ids.borda = expectOk(await a.post('/api/admin/menu/crusts', { name: 'Catupiry', prices: { [ids.sizeG]: 1200 } }), 201).id;
    ids.coca = expectOk(await a.post('/api/admin/menu/products', { category_id: ids.catDrinks, name: 'Coca-Cola 2L', price_cents: 1400 }), 201).id;
    ids.bacon = expectOk(await a.post('/api/admin/menu/addons', { name: 'Bacon extra', price_cents: 600, applies_to: 'pizza' }), 201).id;
    ids.zone = expectOk(await a.post('/api/admin/zones', { name: 'Centro', fee_cents: 700, neighborhoods: ['Centro', 'Vila Nova'] }), 201).id;
    expectOk(await a.post('/api/admin/coupons', { code: 'bemvindo10', type: 'percent', value: 10, max_uses: 1 }), 201);
    expectOk(await a.put('/api/admin/settings', { manual_status: 'open', accept_pix_offline: true, pix_key: 'pix@bella.test', min_order_cents: 2000 }));
  });

  test('não permite usar categoria de outra pizzaria (FK + RLS)', async () => {
    const r = await owner.b.post('/api/admin/menu/products', { category_id: ids.catDrinks, name: 'Invasor', price_cents: 1 });
    assert.equal(r.status, 400);
    const r2 = await owner.b.post('/api/admin/menu/flavors', {
      category_id: (await owner.b.get('/api/admin/menu/categories')).body[0].id, name: 'X', prices: { [ids.sizeG]: 100 },
    });
    assert.equal(r2.status, 400);
  });

  test('KZ-05: categoria com itens não pode ser excluída (sem cascata silenciosa)', async () => {
    const r = await owner.a.del(`/api/admin/menu/categories/${ids.catDrinks}`);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'in_use');
    const products = expectOk(await owner.a.get('/api/admin/menu/products'));
    assert.ok(products.some((p: any) => p.id === ids.coca));
    const empty = expectOk(await owner.a.post('/api/admin/menu/categories', { name: 'Vazia', kind: 'product' }), 201);
    expectOk(await owner.a.del(`/api/admin/menu/categories/${empty.id}`));
  });

  test('cardápio público mostra somente itens da própria pizzaria', async () => {
    const pub = expectOk(await new Client(app).get('/api/public/bella'));
    assert.equal(pub.tenant.name, 'Pizzaria Bella');
    assert.equal(pub.status.open, true);
    assert.deepEqual(pub.ordering.payment_methods.map((m: any) => m.id), ['cash', 'card_on_delivery', 'pix_offline']);
    assert.equal(pub.menu.flavors.length, 2);
    const pubB = expectOk(await new Client(app).get('/api/public/forno-do-ze'));
    assert.equal(pubB.menu.flavors.length, 0);
    assert.equal((await new Client(app).get('/api/public/nao-existe')).status, 404);
  });
});

const pizzaItem = () => ({
  kind: 'pizza', size_id: ids.sizeG, flavor_ids: [ids.calabresa, ids.frango], crust_id: ids.borda, addon_ids: [ids.bacon], quantity: 1,
});

describe('pedido do cliente', () => {
  test('orçamento calculado no servidor (meio a meio pelo mais caro)', async () => {
    const q = expectOk(await new Client(app).post('/api/public/bella/quote', {
      items: [pizzaItem(), { kind: 'product', product_id: ids.coca, quantity: 2 }],
      fulfillment: 'delivery', delivery_zone_id: ids.zone, neighborhood: 'Centro', coupon_code: 'BEMVINDO10',
    }));
    assert.equal(q.items[0].unit_price_cents, 6290 + 1200 + 600);
    assert.equal(q.subtotal_cents, 8090 + 2800);
    assert.equal(q.delivery_fee_cents, 700);
    assert.equal(q.discount_cents, 1089);
    assert.equal(q.total_cents, 10890 + 700 - 1089);
  });

  test('cria pedido de entrega; preço enviado pelo cliente é ignorado', async () => {
    const c = new Client(app);
    const r = await c.post('/api/public/bella/orders', {
      items: [{ ...pizzaItem(), unit_price_cents: 1 }],
      fulfillment: 'delivery', delivery_zone_id: ids.zone, neighborhood: 'Vila Nova',
      address: { street: 'Rua das Flores', number: '100', complement: 'Ap 2' },
      customer: { name: 'Carlos Cliente', phone: '(11) 97777-6666' },
      payment_method: 'cash', change_for_cents: 10000, coupon_code: 'bemvindo10', notes: 'Sem cebola',
    });
    const created = expectOk(r, 201);
    ids.order1 = created.id;
    ids.token1 = created.token;
    assert.equal(created.number, 1);
    const pub = expectOk(await c.get(`/api/public/bella/orders/${created.token}`));
    assert.equal(pub.status, 'pending');
    assert.equal(pub.total_cents, 8090 + 700 - 809);
    assert.equal(pub.address.neighborhood, 'Vila Nova');
  });

  test('cupom esgotado, pedido mínimo, troco e bairro inválido são rejeitados', async () => {
    const base = {
      fulfillment: 'pickup', customer: { name: 'Bia', phone: '11966665555' }, payment_method: 'cash',
    };
    const c = new Client(app);
    let r = await c.post('/api/public/bella/orders', { ...base, items: [pizzaItem()], coupon_code: 'BEMVINDO10' });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /limite/);
    r = await c.post('/api/public/bella/orders', { ...base, items: [{ kind: 'product', product_id: ids.coca, quantity: 1 }] });
    assert.match(r.body.error.message, /mínimo/);
    r = await c.post('/api/public/bella/orders', { ...base, items: [pizzaItem()], change_for_cents: 100 });
    assert.match(r.body.error.message, /troco/);
    r = await c.post('/api/public/bella/orders', {
      ...base, fulfillment: 'delivery', delivery_zone_id: ids.zone, neighborhood: 'Outro', address: { street: 'Rua X', number: '1' }, items: [pizzaItem()],
    });
    assert.equal(r.body.error.code, 'neighborhood_mismatch');
  });

  test('pizzaria fechada não recebe pedidos', async () => {
    expectOk(await owner.b.put('/api/admin/settings', { manual_status: 'closed' }));
    const pub = expectOk(await new Client(app).get('/api/public/forno-do-ze'));
    assert.equal(pub.status.open, false);
  });
});

describe('isolamento entre pizzarias', () => {
  test('pizzaria B não enxerga nem altera pedido da A', async () => {
    assert.equal((await owner.b.get(`/api/admin/orders/${ids.order1}`)).status, 404);
    assert.equal((await owner.b.post(`/api/admin/orders/${ids.order1}/status`, { status: 'accepted' })).status, 404);
    const board = expectOk(await owner.b.get('/api/admin/orders/board'));
    assert.equal(board.length, 0);
    assert.equal((await owner.b.get(`/api/public/forno-do-ze/orders/${ids.token1}`)).status, 404);
  });

  test('RLS no banco: sem contexto não há linhas; contexto errado não insere', async () => {
    const c = new pg.Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      assert.equal((await c.query('SELECT * FROM orders')).rowCount, 0);
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantB]);
      assert.equal((await c.query('SELECT * FROM orders')).rowCount, 0);
      await assert.rejects(
        c.query("INSERT INTO categories (tenant_id, name, kind) VALUES ($1, 'x', 'pizza')", [ids.tenantA]),
        /row-level security/,
      );
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantA]);
      assert.equal((await c.query('SELECT * FROM orders')).rowCount, 1);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});

describe('equipe e permissões', () => {
  const kitchen = { c: null as unknown as Client };
  test('dono cria funcionário da cozinha com senha temporária', async () => {
    const r = expectOk(await owner.a.post('/api/admin/team', { name: 'Pedro Cozinha', email: 'pedro@bella.test', role: 'kitchen' }), 201);
    ids.kitchenUser = r.id;
    kitchen.c = new Client(app);
    expectOk(await kitchen.c.post('/api/auth/login', { email: 'pedro@bella.test', password: r.temporary_password }));
    assert.equal((await kitchen.c.get('/api/admin/orders/board')).status, 403); // precisa trocar a senha
    expectOk(await kitchen.c.post('/api/auth/change-password', { current_password: r.temporary_password, new_password: 'cozinha123' }));
    assert.equal(expectOk(await kitchen.c.get('/api/admin/orders/board')).length, 1);
  });

  test('cozinha prepara, mas não cancela, não edita cardápio e não vê relatórios', async () => {
    const k = kitchen.c;
    expectOk(await k.post(`/api/admin/orders/${ids.order1}/status`, { status: 'accepted' }));
    expectOk(await k.post(`/api/admin/orders/${ids.order1}/status`, { status: 'preparing' }));
    assert.equal((await k.post(`/api/admin/orders/${ids.order1}/status`, { status: 'cancelled', reason: 'x' })).status, 403);
    assert.equal((await k.post(`/api/admin/orders/${ids.order1}/status`, { status: 'out_for_delivery' })).status, 403);
    assert.equal((await k.post('/api/admin/menu/products', { category_id: ids.catDrinks, name: 'X', price_cents: 1 })).status, 403);
    assert.equal((await k.get('/api/admin/reports/sales?from=2020-01-01&to=2030-01-01')).status, 403);
    // pode pausar item esgotado
    expectOk(await k.patch(`/api/admin/menu/products/${ids.coca}`, { available: false }));
    assert.equal((await k.patch(`/api/admin/menu/products/${ids.coca}`, { price_cents: 1 })).status, 403);
    expectOk(await owner.a.patch(`/api/admin/menu/products/${ids.coca}`, { available: true }));
  });

  test('gerente não pode promover a proprietário', async () => {
    const r = expectOk(await owner.a.post('/api/admin/team', { name: 'Gil Gerente', email: 'gil@bella.test', role: 'manager' }), 201);
    const g = new Client(app);
    await g.post('/api/auth/login', { email: 'gil@bella.test', password: r.temporary_password });
    await g.post('/api/auth/change-password', { current_password: r.temporary_password, new_password: 'gerente123' });
    assert.equal((await g.patch(`/api/admin/team/${ids.kitchenUser}`, { role: 'owner' })).status, 403);
    expectOk(await g.patch(`/api/admin/team/${ids.kitchenUser}`, { role: 'attendant' }));
  });
});

describe('ciclo do pedido, caixa e relatórios', () => {
  test('abre caixa, conclui pedido em dinheiro e fecha com conferência', async () => {
    const a = owner.a;
    expectOk(await a.post('/api/admin/cash/open', { opening_cents: 5000 }), 201);
    assert.equal((await a.post('/api/admin/cash/open', { opening_cents: 1 })).status, 409);
    expectOk(await a.post(`/api/admin/orders/${ids.order1}/status`, { status: 'ready' }));
    expectOk(await a.post(`/api/admin/orders/${ids.order1}/status`, { status: 'out_for_delivery' }));
    const done = expectOk(await a.post(`/api/admin/orders/${ids.order1}/status`, { status: 'completed' }));
    assert.equal(done.payment_status, 'paid');
    assert.ok(done.events.length >= 5);
    assert.equal((await a.post(`/api/admin/orders/${ids.order1}/status`, { status: 'cancelled', reason: 'x' })).status, 409);
    expectOk(await a.post('/api/admin/cash/movements', { type: 'withdrawal', amount_cents: 2000, reason: 'Troco do motoboy' }), 201);
    const closed = expectOk(await a.post('/api/admin/cash/close', { counted_cents: 10981 }));
    assert.equal(closed.summary.expected_cash_cents, 5000 + 7981 - 2000);
    assert.equal(closed.difference_cents, 0);
  });

  test('cancelamento exige motivo e libera o cupom', async () => {
    expectOk(await owner.a.patch(`/api/admin/coupons/${(await owner.a.get('/api/admin/coupons')).body[0].id}`, { max_uses: 2 }));
    const c = new Client(app);
    const o = expectOk(await c.post('/api/public/bella/orders', {
      items: [pizzaItem()], fulfillment: 'pickup', customer: { name: 'Duda', phone: '11955554444' },
      payment_method: 'pix_offline', coupon_code: 'BEMVINDO10',
    }), 201);
    assert.equal((await owner.a.post(`/api/admin/orders/${o.id}/status`, { status: 'cancelled' })).status, 400);
    const r = expectOk(await owner.a.post(`/api/admin/orders/${o.id}/status`, { status: 'cancelled', reason: 'Cliente desistiu' }));
    assert.equal(r.cancel_reason, 'Cliente desistiu');
    const coupon = (await owner.a.get('/api/admin/coupons')).body[0];
    assert.equal(coupon.used_count, 1);
  });

  test('relatório de vendas do período', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rep = expectOk(await owner.a.get(`/api/admin/reports/sales?from=2020-01-01&to=${today < '2030-01-01' ? '2030-01-01' : today}`));
    assert.equal(rep.summary.completed, 1);
    assert.equal(rep.summary.revenue_cents, 7981);
    assert.equal(rep.summary.cancelled, 1);
    assert.equal(rep.top_flavors.length, 2);
    assert.equal(rep.by_payment[0].payment_method, 'cash');
  });
});

describe('Pix online via gateway (webhook assinado)', () => {
  const secret = 'webhook-secret-xyz';
  const sign = (dataId: string, requestId: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  };

  test('configura gateway (credenciais nunca retornam)', async () => {
    expectOk(await owner.a.put('/api/admin/payment-gateway', { enabled: true, access_token: 'TEST-access-token-1234567890', webhook_secret: secret }));
    expectOk(await owner.a.put('/api/admin/settings', { accept_pix_online: true }));
    const gw = expectOk(await owner.a.get('/api/admin/payment-gateway'));
    assert.equal(gw.has_access_token, true);
    assert.equal(JSON.stringify(gw).includes('TEST-access'), false);
  });

  test('pedido aguarda pagamento, webhook falso é rejeitado, webhook válido confirma', async () => {
    const c = new Client(app);
    const missingEmail = await c.post('/api/public/bella/orders', {
      items: [pizzaItem()], fulfillment: 'pickup', customer: { name: 'Eva', phone: '11944443333' }, payment_method: 'pix_online',
    });
    assert.equal(missingEmail.body.error.code, 'email_required');
    const o = expectOk(await c.post('/api/public/bella/orders', {
      items: [pizzaItem()], fulfillment: 'pickup', customer: { name: 'Eva', phone: '11944443333', email: 'eva@cliente.test' },
      payment_method: 'pix_online',
    }), 201);
    let pub = expectOk(await c.get(`/api/public/bella/orders/${o.token}`));
    assert.equal(pub.status, 'awaiting_payment');
    assert.equal(pub.pix.qr_code, '00020126PIXCOPIAECOLA');
    const board = expectOk(await owner.a.get('/api/admin/orders/board'));
    assert.equal(board.find((x: any) => x.id === o.id).status, 'awaiting_payment');

    const paymentId = [...mpPayments.values()].find((p) => p.external_reference === o.id)!.id.toString();
    const url = `/api/webhooks/mercadopago/${ids.tenantA}?data.id=${paymentId}&type=payment`;
    const body = { type: 'payment', action: 'payment.updated', data: { id: paymentId } };

    // Assinatura inválida
    const bad = await new Client(app).req('POST', url, body, { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'r0' });
    assert.equal(bad.status, 401);

    // Assinatura válida mas pagamento ainda pendente no gateway → nada muda
    expectOk(await new Client(app).req('POST', url, body, sign(paymentId, 'r1')));
    pub = expectOk(await c.get(`/api/public/bella/orders/${o.token}`));
    assert.equal(pub.status, 'awaiting_payment');

    // Pagamento aprovado no gateway
    mpPayments.get(paymentId)!.status = 'approved';
    expectOk(await new Client(app).req('POST', url, body, sign(paymentId, 'r2')));
    pub = expectOk(await c.get(`/api/public/bella/orders/${o.token}`));
    assert.equal(pub.status, 'pending');
    assert.equal(pub.payment_status, 'paid');

    // Equipe não pode "confirmar manualmente" pagamento online
    assert.equal((await owner.a.post(`/api/admin/orders/${o.id}/confirm-payment`)).status, 400);
  });
});

describe('KZ-24: histórico de pedidos', () => {
  test('lista sem filtros, por nome, por telefone, por número e por período', async () => {
    const all = expectOk(await owner.a.get('/api/admin/orders?limit=30&offset=0'));
    assert.ok(all.orders.length >= 3);
    assert.ok(expectOk(await owner.a.get('/api/admin/orders?q=Carlos')).orders.length >= 1);
    assert.ok(expectOk(await owner.a.get('/api/admin/orders?q=11977776666')).orders.length >= 1);
    assert.equal(expectOk(await owner.a.get('/api/admin/orders?q=%231')).orders[0].number, 1);
    assert.ok(expectOk(await owner.a.get('/api/admin/orders?from=2020-01-01&to=2030-12-31&q=Carlos')).orders.length >= 1);
  });
});

describe('KZ-06: cancelamento de pedido já pago', () => {
  test('vira "a devolver", segue na gaveta até a devolução e sai do esperado depois', async () => {
    const a = owner.a;
    expectOk(await a.post('/api/admin/cash/open', { opening_cents: 1000 }), 201);
    const o = expectOk(await new Client(app).post('/api/public/bella/orders', {
      items: [pizzaItem()], fulfillment: 'pickup', customer: { name: 'Hana Devolve', phone: '11911112222' }, payment_method: 'cash',
    }), 201);
    const paid = expectOk(await a.post(`/api/admin/orders/${o.id}/confirm-payment`));
    const total = paid.total_cents;
    let cash = expectOk(await a.get('/api/admin/cash/current')).summary;
    assert.equal(cash.expected_cash_cents, 1000 + total);

    const cancelled = expectOk(await a.post(`/api/admin/orders/${o.id}/status`, { status: 'cancelled', reason: 'Pizza queimou' }));
    assert.equal(cancelled.payment_status, 'refund_pending');
    cash = expectOk(await a.get('/api/admin/cash/current')).summary;
    assert.equal(cash.by_method.find((m: any) => m.payment_method === 'cash'), undefined);
    assert.equal(cash.cash_to_return_cents, total);
    assert.equal(cash.expected_cash_cents, 1000 + total);

    const refunded = expectOk(await a.post(`/api/admin/orders/${o.id}/confirm-refund`));
    assert.equal(refunded.payment_status, 'refunded');
    cash = expectOk(await a.get('/api/admin/cash/current')).summary;
    assert.equal(cash.expected_cash_cents, 1000);
    assert.equal((await a.post(`/api/admin/orders/${o.id}/confirm-refund`)).status, 409);
    expectOk(await a.post('/api/admin/cash/close', { counted_cents: 1000 }));
  });
});

describe('KZ-04: idempotência do pedido', () => {
  test('mesma chave enviada em paralelo e repetida gera um único pedido', async () => {
    const body = {
      items: [pizzaItem()], fulfillment: 'pickup', customer: { name: 'Gil Repetido', phone: '11922221111' },
      payment_method: 'cash', idempotency_key: 'chk_teste_idem_000001',
    };
    const c = new Client(app);
    const [r1, r2] = await Promise.all([c.post('/api/public/bella/orders', body), c.post('/api/public/bella/orders', body)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
    assert.equal(r1.body.token, r2.body.token);
    const again = await c.post('/api/public/bella/orders', body);
    assert.equal(again.status, 200);
    assert.equal(again.body.number, r1.body.number);
    const list = expectOk(await owner.a.get('/api/admin/orders?q=Gil%20Repetido'));
    assert.equal(list.orders.length, 1);
    const other = await c.post('/api/public/bella/orders', { ...body, idempotency_key: 'chk_teste_idem_000002' });
    assert.equal(other.status, 201);
    assert.notEqual(other.body.number, r1.body.number);
  });
});

describe('tempo real (SSE)', () => {
  test('painel recebe novo pedido via LISTEN/NOTIFY', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/admin/events`, { headers: { cookie: owner.a.cookie }, signal: ctrl.signal });
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const waitFor = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!buffer.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`timeout esperando ${needle}; recebido: ${buffer}`);
        const { value } = await reader.read();
        buffer += decoder.decode(value);
      }
    };
    try {
      await waitFor('event: ready');
      const o = expectOk(await new Client(app).post('/api/public/bella/orders', {
        items: [pizzaItem()], fulfillment: 'pickup', customer: { name: 'Fábio', phone: '11933332222' }, payment_method: 'card_on_delivery',
      }), 201);
      await waitFor(`"orderId":"${o.id}"`);
      assert.match(buffer, /event: order\.created/);
    } finally {
      ctrl.abort();
    }
  });

  // KZ-01: o navegador só detecta conexão morta se receber um evento nomeado periodicamente.
  test('stream envia evento "ping" nomeado para vigilância do cliente', async () => {
    const address = app.server.listening ? `http://127.0.0.1:${(app.server.address() as any).port}` : await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/api/admin/events`, { headers: { cookie: owner.a.cookie }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + 3000;
    try {
      while (!buffer.includes('event: ping')) {
        if (Date.now() > deadline) throw new Error(`sem ping; recebido: ${buffer}`);
        buffer += decoder.decode((await reader.read()).value);
      }
    } finally {
      ctrl.abort();
    }
  });
});
