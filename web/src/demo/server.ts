/**
 * MODO DEMONSTRAÇÃO (somente no build VITE_DEMO=1, ex.: GitHub Pages).
 *
 * Simula a API no próprio navegador para que seja possível navegar e testar a lógica
 * sem backend. Os dados ficam no localStorage DESTE navegador, nada é enviado a servidores,
 * e NÃO há pagamento online. As regras de preço, cupons, horários, fluxo de status e
 * permissões são as MESMAS do servidor (importadas de server/src/domain e lib).
 * O sistema real usa o backend Node.js + PostgreSQL (pasta /server).
 */
import { resolveOpenStatus } from '../../../server/src/domain/hours';
import { canTransition, PAYMENT_LABELS, permissionFor, STATUS_LABELS, STATUS_TIMESTAMP, type OrderStatus } from '../../../server/src/domain/orderFlow';
import { couponDiscount, priceItem, PricingError, type Catalog, type CartItemInput } from '../../../server/src/domain/pricing';
import { can, canAssignRole, ROLE_LABELS, ROLE_PERMISSIONS, type Role } from '../../../server/src/lib/permissions';

const KEY = 'kz_demo_db_v1';
const SESSION_KEY = 'kz_demo_session_v1';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kz_demo_events') : null;

type Row = Record<string, any>;
interface DB {
  tenants: Row[];
  users: Row[];
  memberships: Row[];
  settings: Record<string, Row>;
  hours: Row[];
  zones: Row[];
  categories: Row[];
  sizes: Row[];
  flavors: Row[];
  crusts: Row[];
  products: Row[];
  addons: Row[];
  coupons: Row[];
  customers: Row[];
  orders: Row[];
  cash_sessions: Row[];
  cash_movements: Row[];
  audit: Row[];
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
async function hash(p: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kzann-demo:${p}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────── Persistência ─────────
function load(): DB | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}
function save(db: DB) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* cota excedida: mantém em memória */
  }
}
let memory: DB | null = null;
let seeding: Promise<DB> | null = null;
async function getDb(): Promise<DB> {
  const db = load() ?? memory ?? (await (seeding ??= seed()));
  memory = db;
  return db;
}
function session(): { userId: string; tenantId: string | null } | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function setSession(s: { userId: string; tenantId: string | null } | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

export function resetDemo() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SESSION_KEY);
  memory = null;
}

// ───────── Eventos em tempo real (entre abas, via BroadcastChannel) ─────────
type Listener = (type: string, data: any) => void;
const listeners = new Set<{ path: string; fn: Listener }>();
function emit(tenantId: string, order: Row, type: string) {
  const ev = { tenantId, orderId: order.id, token: order.public_token, type, status: order.status, number: order.number };
  deliver(ev);
  channel?.postMessage(ev);
}
function deliver(ev: any) {
  const s = session();
  listeners.forEach(({ path, fn }) => {
    if (path === '/api/admin/events' && s?.tenantId === ev.tenantId) fn(ev.type, ev);
    if (path.endsWith(`/orders/${ev.token}/events`)) fn(ev.type, { status: ev.status });
  });
}
channel?.addEventListener('message', (e) => {
  memory = null;
  deliver(e.data);
});
export function subscribe(path: string, fn: Listener) {
  const entry = { path, fn };
  listeners.add(entry);
  setTimeout(() => fn('ready', {}), 0);
  return () => listeners.delete(entry);
}

// ───────── Dados de exemplo ─────────
async function seed(): Promise<DB> {
  const t = uid();
  const db: DB = {
    tenants: [{ id: t, slug: 'pizzaria-demo', name: 'Pizzaria Demo', status: 'active' }],
    users: [],
    memberships: [],
    settings: {},
    hours: [],
    zones: [],
    categories: [],
    sizes: [],
    flavors: [],
    crusts: [],
    products: [],
    addons: [],
    coupons: [],
    customers: [],
    orders: [],
    cash_sessions: [],
    cash_movements: [],
    audit: [],
  };
  const owner = { id: uid(), email: 'dono@demo.kzann', name: 'Dona Maria', password_hash: await hash('demo1234'), must_change_password: false, created_by_tenant_id: null };
  const cook = { id: uid(), email: 'cozinha@demo.kzann', name: 'Chef Paulo', password_hash: await hash('demo1234'), must_change_password: false, created_by_tenant_id: t };
  db.users.push(owner, cook);
  db.memberships.push({ tenant_id: t, user_id: owner.id, role: 'owner', active: true, created_at: now() }, { tenant_id: t, user_id: cook.id, role: 'kitchen', active: true, created_at: now() });
  db.settings[t] = defaultSettings({
    description: 'Pizzas artesanais em forno a lenha desde 1998',
    whatsapp_phone: '11999990000',
    address: 'Rua das Pizzas, 123 — Centro',
    manual_status: 'open',
    min_order_cents: 2500,
    accept_pix_offline: true,
    pix_key: 'pix@pizzariademo.com.br',
    pix_key_holder: 'Pizzaria Demo LTDA',
  });
  for (let d = 0; d <= 6; d++) db.hours.push({ id: uid(), tenant_id: t, weekday: d, opens: '18:00', closes: '23:30' });
  const S = (name: string, slices: number, max: number, sort: number) => {
    const r = { id: uid(), tenant_id: t, name, slices, max_flavors: max, sort, active: true };
    db.sizes.push(r);
    return r.id;
  };
  const broto = S('Broto', 4, 1, 1), media = S('Média', 6, 2, 2), grande = S('Grande', 8, 3, 3), gigante = S('Gigante', 12, 4, 4);
  const C = (name: string, kind: string, sort: number) => {
    const r = { id: uid(), tenant_id: t, name, kind, sort, active: true };
    db.categories.push(r);
    return r.id;
  };
  const trad = C('Pizzas Tradicionais', 'pizza', 1), esp = C('Pizzas Especiais', 'pizza', 2), doce = C('Pizzas Doces', 'pizza', 3), beb = C('Bebidas', 'product', 4), sob = C('Sobremesas', 'product', 5);
  const F = (cat: string, name: string, description: string, base: number) => {
    db.flavors.push({
      id: uid(), tenant_id: t, category_id: cat, name, description, image_url: null, sort: 0, active: true, available: true,
      prices: { [broto]: base - 1800, [media]: base - 900, [grande]: base, [gigante]: base + 1800 },
    });
  };
  F(trad, 'Mussarela', 'Molho de tomate, mussarela e orégano', 4990);
  F(trad, 'Calabresa', 'Calabresa fatiada, cebola e azeitonas', 5290);
  F(trad, 'Marguerita', 'Mussarela, tomate e manjericão fresco', 5490);
  F(trad, 'Portuguesa', 'Presunto, ovos, cebola, ervilha e mussarela', 5690);
  F(esp, 'Frango com Catupiry', 'Frango desfiado temperado com Catupiry original', 5990);
  F(esp, 'Quatro Queijos', 'Mussarela, provolone, parmesão e gorgonzola', 6290);
  F(esp, 'Pepperoni', 'Pepperoni artesanal e mussarela', 6490);
  F(esp, 'Camarão', 'Camarões salteados no alho com Catupiry', 7990);
  F(doce, 'Chocolate com Morango', 'Chocolate ao leite e morangos frescos', 5490);
  F(doce, 'Romeu e Julieta', 'Goiabada cremosa com mussarela', 4990);
  db.flavors[7].available = false; // camarão "esgotado" para demonstrar
  const B = (name: string, p: number) => db.crusts.push({ id: uid(), tenant_id: t, name, sort: 0, active: true, available: true, prices: { [media]: p, [grande]: p + 300, [gigante]: p + 600 } });
  B('Catupiry', 900);
  B('Cheddar', 900);
  B('Chocolate', 1000);
  const P = (cat: string, name: string, description: string, price: number) =>
    db.products.push({ id: uid(), tenant_id: t, category_id: cat, name, description, image_url: null, price_cents: price, sort: 0, active: true, available: true });
  P(beb, 'Coca-Cola 2L', 'Gelada', 1400);
  P(beb, 'Guaraná Antarctica 2L', 'Gelado', 1200);
  P(beb, 'Suco natural 500ml', 'Laranja ou limão', 900);
  P(beb, 'Água mineral 500ml', 'Com ou sem gás', 400);
  P(sob, 'Brownie com sorvete', 'Brownie de chocolate meio amargo com sorvete de creme', 1800);
  const A = (name: string, price: number, applies_to: string) => db.addons.push({ id: uid(), tenant_id: t, name, price_cents: price, applies_to, sort: 0, active: true, available: true });
  A('Bacon extra', 600, 'pizza');
  A('Catupiry extra', 500, 'pizza');
  A('Azeitonas extras', 300, 'pizza');
  const Z = (name: string, fee: number, neighborhoods: string[], eta: number | null) =>
    db.zones.push({ id: uid(), tenant_id: t, name, fee_cents: fee, neighborhoods, min_order_cents: null, eta_minutes: eta, active: true, sort: 0 });
  Z('Centro', 500, ['Centro', 'Vila Nova', 'Jardim América'], 35);
  Z('Região Norte', 800, ['Santa Cecília', 'Bela Vista', 'Parque das Flores'], 45);
  Z('Região Sul', 1200, ['Vila Mariana', 'Jardim do Sol'], 60);
  db.coupons.push(
    { id: uid(), tenant_id: t, code: 'BEMVINDO10', type: 'percent', value: 10, min_order_cents: 0, max_uses: null, used_count: 0, starts_at: null, ends_at: null, active: true, created_at: now() },
    { id: uid(), tenant_id: t, code: 'FRETEGRATIS', type: 'free_delivery', value: 0, min_order_cents: 6000, max_uses: 100, used_count: 0, starts_at: null, ends_at: null, active: true, created_at: now() },
  );

  // Histórico de vendas dos últimos dias (alimenta relatórios da demo)
  const names = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Alves', 'Eva Rocha', 'Fábio Nunes', 'Gabi Costa', 'Hugo Reis'];
  const cat = buildCatalog(db, t);
  for (let day = 6; day >= 1; day--) {
    const count = 3 + ((day * 7) % 5);
    for (let k = 0; k < count; k++) {
      const date = new Date();
      date.setDate(date.getDate() - day);
      date.setHours(19 + (k % 4), (k * 13) % 60, 0, 0);
      const fl = db.flavors.filter((f) => f.available);
      const items: CartItemInput[] = [
        { kind: 'pizza', size_id: grande, flavor_ids: [fl[(k + day) % fl.length].id, fl[(k * 3 + 1) % fl.length].id], quantity: 1 },
        ...(k % 2 ? [{ kind: 'product' as const, product_id: db.products[k % 3].id, quantity: 1 }] : []),
      ];
      const priced = items.map((i) => priceItem(cat, i));
      const subtotal = priced.reduce((s, i) => s + i.total_cents, 0);
      const delivery = k % 3 !== 0;
      const fee = delivery ? db.zones[k % 3].fee_cents : 0;
      const cancelled = (day + k) % 11 === 0;
      const name = names[(day + k) % names.length];
      const method = ['cash', 'card_on_delivery', 'pix_offline'][k % 3];
      const t0 = date.toISOString();
      const t1 = new Date(date.getTime() + 40 * 60000).toISOString();
      db.orders.push({
        id: uid(), tenant_id: t, number: db.orders.length + 1, public_token: token(), customer_name: name, customer_phone: `1198${String(1000000 + day * 100 + k)}`,
        fulfillment: delivery ? 'delivery' : 'pickup',
        address: delivery ? { street: 'Rua Exemplo', number: String(10 + k), complement: '', reference: '', neighborhood: db.zones[k % 3].neighborhoods[0], zone: db.zones[k % 3].name } : null,
        delivery_zone_id: delivery ? db.zones[k % 3].id : null, status: cancelled ? 'cancelled' : 'completed', payment_method: method,
        payment_status: cancelled ? 'cancelled' : 'paid', change_for_cents: null, subtotal_cents: subtotal, delivery_fee_cents: fee, discount_cents: 0,
        total_cents: subtotal + fee, coupon_id: null, coupon_code: null, notes: '', eta_minutes: 45, cancel_reason: cancelled ? 'Cliente desistiu' : null,
        created_at: t0, accepted_at: t0, ready_at: t1, dispatched_at: null, completed_at: cancelled ? null : t1, cancelled_at: cancelled ? t1 : null, paid_at: cancelled ? null : t1,
        items: priced.map((p) => ({ id: uid(), ...p })), events: [{ id: 1, type: 'created', to_status: 'pending', message: 'Pedido recebido pelo cardápio online', created_at: t0 }],
      });
    }
  }
  db.settings[t].order_counter = db.orders.length;
  save(db);
  return db;
}

function defaultSettings(over: Row = {}): Row {
  return {
    description: '', whatsapp_phone: '', address: '', logo_url: null, cover_url: null, primary_color: '#E4572E', secondary_color: '#1F2937',
    timezone: 'America/Sao_Paulo', manual_status: 'auto', min_order_cents: 0, delivery_enabled: true, pickup_enabled: true,
    delivery_eta_minutes: 45, pickup_eta_minutes: 25, half_half_pricing: 'highest', accept_cash: true, accept_card_on_delivery: true,
    accept_pix_offline: false, accept_pix_online: false, pix_key: '', pix_key_holder: '', auto_accept: false,
    whatsapp_template: 'Olá! 🍕 Faça seu pedido na {pizzaria} pelo nosso cardápio online: {link}', order_counter: 0, ...over,
  };
}

// ───────── Regras ─────────
function buildCatalog(db: DB, t: string): Catalog {
  const of = (rows: Row[]) => new Map(rows.filter((r) => r.tenant_id === t).map((r) => [r.id, r as any]));
  const prices = (rows: Row[]) => new Map(rows.filter((r) => r.tenant_id === t).flatMap((r) => Object.entries(r.prices as Record<string, number>).map(([s, p]) => [`${r.id}:${s}`, p] as [string, number])));
  return {
    halfHalfPricing: db.settings[t].half_half_pricing,
    sizes: of(db.sizes), flavors: of(db.flavors), flavorPrices: prices(db.flavors), crusts: of(db.crusts), crustPrices: prices(db.crusts),
    products: of(db.products), addons: of(db.addons),
  };
}
const isOpen = (db: DB, t: string) => resolveOpenStatus(db.settings[t].manual_status, db.hours.filter((h) => h.tenant_id === t) as any, db.settings[t].timezone);
const tenantBySlug = (db: DB, slug: string) => db.tenants.find((x) => x.slug === slug && x.status === 'active') ?? fail(404, 'not_found', 'Pizzaria não encontrada');

function quote(db: DB, t: string, body: any, strict: boolean) {
  const s = db.settings[t];
  const catalog = buildCatalog(db, t);
  let items;
  try {
    items = (body.items ?? []).map((i: CartItemInput) => priceItem(catalog, i));
  } catch (e) {
    if (e instanceof PricingError) fail(400, e.code, e.message);
    throw e;
  }
  if (!items.length) fail(400, 'validation', 'Carrinho vazio');
  const subtotal = items.reduce((a: number, i: any) => a + i.total_cents, 0);
  let fee = 0, zone: Row | null = null, minOrder = s.min_order_cents, eta = s.pickup_eta_minutes;
  if (body.fulfillment === 'delivery') {
    if (!s.delivery_enabled) fail(400, 'delivery_disabled', 'Esta pizzaria não está fazendo entregas no momento');
    eta = s.delivery_eta_minutes;
    if (body.delivery_zone_id) {
      zone = db.zones.find((z) => z.id === body.delivery_zone_id && z.tenant_id === t && z.active) ?? fail(400, 'zone_unavailable', 'Região de entrega indisponível');
      if (zone!.neighborhoods.length && !zone!.neighborhoods.includes(body.neighborhood ?? '')) fail(400, 'neighborhood_mismatch', 'Bairro não atendido por esta região');
      fee = zone!.fee_cents;
      if (zone!.eta_minutes) eta = zone!.eta_minutes;
      if (zone!.min_order_cents != null) minOrder = Math.max(minOrder, zone!.min_order_cents);
    }
  } else if (!s.pickup_enabled) fail(400, 'pickup_disabled', 'Esta pizzaria não está aceitando retirada no momento');
  let discount = 0, coupon: Row | null = null, couponError: string | null = null;
  if (body.coupon_code) {
    const c = db.coupons.find((x) => x.tenant_id === t && x.code === String(body.coupon_code).toUpperCase());
    try {
      if (!c) throw new PricingError('coupon_invalid', 'Cupom inválido');
      discount = couponDiscount(c as any, subtotal, fee);
      coupon = c;
    } catch (e) {
      if (!(e instanceof PricingError)) throw e;
      if (strict) fail(400, e.code, e.message);
      couponError = e.message;
    }
  }
  return {
    items, subtotal_cents: subtotal, delivery_fee_cents: fee, discount_cents: discount, total_cents: Math.max(0, subtotal + fee - discount),
    min_order_cents: minOrder, coupon: coupon && { id: coupon.id, code: coupon.code, type: coupon.type }, coupon_error: couponError,
    zone: zone && { id: zone.id, name: zone.name, eta_minutes: zone.eta_minutes }, eta_minutes: eta,
  };
}

function authCtx(db: DB, needTenant = true) {
  const s = session();
  const user = s && db.users.find((u) => u.id === s.userId);
  if (!user) fail(401, 'unauthorized', 'Faça login para continuar');
  const m = s!.tenantId ? db.memberships.find((x) => x.tenant_id === s!.tenantId && x.user_id === user!.id && x.active) : null;
  if (needTenant && !m) fail(403, 'forbidden', 'Selecione uma pizzaria');
  return { user: user!, tenantId: m?.tenant_id as string, role: m?.role as Role };
}
function perm(db: DB, p: Parameters<typeof can>[1]) {
  const a = authCtx(db);
  if (a.user.must_change_password) fail(403, 'forbidden', 'Altere sua senha temporária para continuar');
  if (!can(a.role, p)) fail(403, 'forbidden', 'Você não tem permissão para esta ação');
  return a;
}
function addEvent(o: Row, ev: Row) {
  o.events.push({ id: o.events.length + 1, created_at: now(), ...ev });
}
const listMemberships = (db: DB, userId: string) =>
  db.memberships.filter((m) => m.user_id === userId && m.active).map((m) => {
    const t = db.tenants.find((x) => x.id === m.tenant_id)!;
    return { id: t.id, slug: t.slug, name: t.name, role: m.role, role_label: ROLE_LABELS[m.role as Role] };
  });
const localDay = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function cashSummary(db: DB, t: string, s: Row) {
  const until = s.closed_at ?? now();
  const paid = db.orders.filter((o) => o.tenant_id === t && o.paid_at && o.paid_at >= s.opened_at && o.paid_at <= until);
  const methods = new Map<string, { payment_method: string; orders: number; total_cents: number }>();
  for (const o of paid) {
    const m = methods.get(o.payment_method) ?? { payment_method: o.payment_method, orders: 0, total_cents: 0 };
    m.orders++;
    m.total_cents += o.total_cents;
    methods.set(o.payment_method, m);
  }
  const movements = db.cash_movements.filter((m) => m.session_id === s.id);
  const sup = movements.filter((m) => m.type === 'supply').reduce((a, m) => a + m.amount_cents, 0);
  const wd = movements.filter((m) => m.type === 'withdrawal').reduce((a, m) => a + m.amount_cents, 0);
  const cancelled = db.orders.filter((o) => o.tenant_id === t && o.cancelled_at && o.cancelled_at >= s.opened_at && o.cancelled_at <= until);
  const byMethod = [...methods.values()];
  return {
    by_method: byMethod, total_received_cents: byMethod.reduce((a, m) => a + m.total_cents, 0), movements, supplies_cents: sup, withdrawals_cents: wd,
    expected_cash_cents: s.opening_cents + (methods.get('cash')?.total_cents ?? 0) + sup - wd,
    cancelled: { orders: cancelled.length, total_cents: cancelled.reduce((a, o) => a + o.total_cents, 0) },
  };
}

const MENU_TABLES: Record<string, keyof DB> = {
  categories: 'categories', sizes: 'sizes', flavors: 'flavors', crusts: 'crusts', products: 'products', addons: 'addons',
};

// ───────── Roteador ─────────
type Ctx = { db: DB; body: any; params: string[]; query: URLSearchParams };
type H = (c: Ctx) => any | Promise<any>;
const routes: [string, RegExp, H][] = [];
const on = (method: string, pattern: string, h: H) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:[a-z_]+/g, '([^/]+)')}$`), h]);

// Autenticação
on('POST', '/api/auth/login', async ({ db, body }) => {
  const u = db.users.find((x) => x.email.toLowerCase() === String(body.email).trim().toLowerCase());
  if (!u || u.password_hash !== (await hash(body.password))) fail(401, 'unauthorized', 'E-mail ou senha incorretos');
  const tenants = listMemberships(db, u!.id);
  setSession({ userId: u!.id, tenantId: tenants.length === 1 ? tenants[0].id : null });
  return { ok: true, tenants };
});
on('POST', '/api/auth/logout', () => {
  setSession(null);
  return { ok: true };
});
on('GET', '/api/auth/me', ({ db }) => {
  const s = session();
  const u = s && db.users.find((x) => x.id === s.userId);
  if (!u) fail(401, 'unauthorized', 'Faça login');
  const tenants = listMemberships(db, u!.id);
  const current = tenants.find((x) => x.id === s!.tenantId) ?? null;
  return {
    user: { id: u!.id, name: u!.name, email: u!.email, must_change_password: u!.must_change_password },
    tenant: current, role: current?.role ?? null, permissions: current ? ROLE_PERMISSIONS[current.role as Role] : [], tenants,
  };
});
on('POST', '/api/auth/switch-tenant', ({ db, body }) => {
  const a = authCtx(db, false);
  if (!listMemberships(db, a.user.id).some((t) => t.id === body.tenant_id)) fail(403, 'forbidden', 'Você não faz parte desta pizzaria');
  setSession({ userId: a.user.id, tenantId: body.tenant_id });
  return { ok: true };
});
on('POST', '/api/auth/change-password', async ({ db, body }) => {
  const a = authCtx(db, false);
  if (a.user.password_hash !== (await hash(body.current_password))) fail(400, 'wrong_password', 'Senha atual incorreta');
  if (String(body.new_password).length < 8 || !/\d/.test(body.new_password) || !/[a-z]/i.test(body.new_password)) fail(400, 'validation', 'Use ao menos 8 caracteres com letras e números');
  a.user.password_hash = await hash(body.new_password);
  a.user.must_change_password = false;
  return { ok: true };
});
on('POST', '/api/auth/signup', async ({ db, body }) => {
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(body.slug ?? '')) fail(400, 'validation', 'Endereço do cardápio inválido');
  if (String(body.password).length < 8) fail(400, 'validation', 'A senha deve ter pelo menos 8 caracteres');
  if (db.users.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase())) fail(409, 'email_taken', 'Este e-mail já está cadastrado. Faça login.');
  if (db.tenants.some((t) => t.slug === body.slug)) fail(409, 'slug_taken', 'Este endereço de cardápio já está em uso');
  const t = uid(), u = uid();
  db.users.push({ id: u, email: body.email, name: body.name, password_hash: await hash(body.password), must_change_password: false });
  db.tenants.push({ id: t, slug: body.slug, name: body.pizzeria_name, status: 'active' });
  db.settings[t] = defaultSettings({ whatsapp_phone: String(body.whatsapp_phone ?? '').replace(/\D/g, '') });
  db.memberships.push({ tenant_id: t, user_id: u, role: 'owner', active: true, created_at: now() });
  [['Broto', 4, 1], ['Média', 6, 2], ['Grande', 8, 2], ['Gigante', 12, 3]].forEach(([name, slices, max], i) =>
    db.sizes.push({ id: uid(), tenant_id: t, name, slices, max_flavors: max, sort: i + 1, active: true }));
  [['Pizzas Tradicionais', 'pizza'], ['Pizzas Especiais', 'pizza'], ['Pizzas Doces', 'pizza'], ['Bebidas', 'product']].forEach(([name, kind], i) =>
    db.categories.push({ id: uid(), tenant_id: t, name, kind, sort: i + 1, active: true }));
  for (let d = 0; d <= 6; d++) if (d !== 1) db.hours.push({ id: uid(), tenant_id: t, weekday: d, opens: '18:00', closes: '23:30' });
  setSession({ userId: u, tenantId: t });
  return { ok: true, tenant: { id: t, slug: body.slug } };
});

// Público
on('GET', '/api/public/:slug', ({ db, params }) => {
  const t = tenantBySlug(db, params[0]);
  const s = db.settings[t.id];
  const methods = [
    s.accept_cash && 'cash', s.accept_card_on_delivery && 'card_on_delivery', s.accept_pix_offline && s.pix_key && 'pix_offline',
  ].filter(Boolean) as (keyof typeof PAYMENT_LABELS)[];
  const mine = (rows: Row[]) => rows.filter((r) => r.tenant_id === t.id && r.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  return {
    tenant: { slug: t.slug, name: t.name, ...pick(s, ['description', 'address', 'whatsapp_phone', 'logo_url', 'cover_url', 'primary_color', 'secondary_color', 'timezone']) },
    status: { open: isOpen(db, t.id), manual_status: s.manual_status, hours: db.hours.filter((h) => h.tenant_id === t.id).sort((a, b) => a.weekday - b.weekday) },
    ordering: {
      ...pick(s, ['delivery_enabled', 'pickup_enabled', 'delivery_eta_minutes', 'pickup_eta_minutes', 'min_order_cents', 'half_half_pricing']),
      payment_methods: methods.map((m) => ({ id: m, label: PAYMENT_LABELS[m] })),
      pix_key: s.accept_pix_offline ? s.pix_key : null, pix_key_holder: s.accept_pix_offline ? s.pix_key_holder : null,
    },
    zones: mine(db.zones),
    menu: {
      categories: mine(db.categories), sizes: mine(db.sizes), flavors: mine(db.flavors), crusts: mine(db.crusts), products: mine(db.products), addons: mine(db.addons),
    },
  };
});
on('POST', '/api/public/:slug/quote', ({ db, params, body }) => quote(db, tenantBySlug(db, params[0]).id, body, false));
on('POST', '/api/public/:slug/orders', ({ db, params, body }) => {
  const t = tenantBySlug(db, params[0]).id;
  const s = db.settings[t];
  if (!isOpen(db, t)) fail(409, 'closed', 'A pizzaria está fechada no momento');
  const name = String(body.customer?.name ?? '').trim();
  const phone = String(body.customer?.phone ?? '').replace(/\D/g, '');
  if (name.length < 2) fail(400, 'validation', 'Informe seu nome');
  if (phone.length < 10) fail(400, 'validation', 'Telefone inválido');
  if (body.fulfillment === 'delivery' && (!body.address || !body.delivery_zone_id)) fail(400, 'address_required', 'Informe o endereço de entrega');
  const ok = { cash: s.accept_cash, card_on_delivery: s.accept_card_on_delivery, pix_offline: s.accept_pix_offline && s.pix_key, pix_online: false }[body.payment_method as string];
  if (!ok) fail(400, 'payment_method_unavailable', 'Forma de pagamento indisponível');
  const q = quote(db, t, body, true);
  if (q.subtotal_cents < q.min_order_cents) fail(400, 'min_order', `Pedido mínimo de ${(q.min_order_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  if (body.payment_method === 'cash' && body.change_for_cents && body.change_for_cents < q.total_cents) fail(400, 'invalid_change', 'O valor para troco deve ser maior que o total');
  s.order_counter += 1;
  let cust = db.customers.find((c) => c.tenant_id === t && c.phone === phone);
  if (!cust) db.customers.push((cust = { id: uid(), tenant_id: t, phone, name, orders_count: 0, created_at: now() }));
  cust.name = name;
  cust.orders_count++;
  cust.updated_at = now();
  const status: OrderStatus = s.auto_accept ? 'accepted' : 'pending';
  const o: Row = {
    id: uid(), tenant_id: t, number: s.order_counter, public_token: token(), customer_id: cust.id, customer_name: name, customer_phone: phone, customer_email: null,
    fulfillment: body.fulfillment, address: body.fulfillment === 'delivery' ? { ...body.address, neighborhood: body.neighborhood, zone: q.zone?.name } : null,
    delivery_zone_id: q.zone?.id ?? null, status, payment_method: body.payment_method, payment_status: 'pending',
    change_for_cents: body.payment_method === 'cash' ? body.change_for_cents ?? null : null,
    subtotal_cents: q.subtotal_cents, delivery_fee_cents: q.delivery_fee_cents, discount_cents: q.discount_cents, total_cents: q.total_cents,
    coupon_id: q.coupon?.id ?? null, coupon_code: q.coupon?.code ?? null, notes: String(body.notes ?? '').slice(0, 500), eta_minutes: q.eta_minutes,
    cancel_reason: null, created_at: now(), accepted_at: status === 'accepted' ? now() : null, items: q.items.map((i: any) => ({ id: uid(), ...i })), events: [],
  };
  addEvent(o, { type: 'created', to_status: status, message: 'Pedido recebido pelo cardápio online' });
  if (q.coupon) db.coupons.find((c) => c.id === q.coupon!.id)!.used_count++;
  db.orders.push(o);
  queueMicrotask(() => emit(t, o, 'order.created'));
  return { id: o.id, number: o.number, token: o.public_token };
});
on('GET', '/api/public/:slug/orders/:token', ({ db, params }) => {
  const t = tenantBySlug(db, params[0]).id;
  const o = db.orders.find((x) => x.tenant_id === t && x.public_token === params[1]) ?? fail(404, 'not_found', 'Pedido não encontrado');
  return {
    ...pick(o!, ['id', 'number', 'status', 'fulfillment', 'customer_name', 'customer_phone', 'address', 'payment_method', 'payment_status', 'change_for_cents', 'subtotal_cents', 'delivery_fee_cents', 'discount_cents', 'total_cents', 'coupon_code', 'notes', 'eta_minutes', 'cancel_reason', 'created_at']),
    items: o!.items, timeline: o!.events.filter((e: Row) => e.to_status).map((e: Row) => ({ to_status: e.to_status, created_at: e.created_at })), pix: null,
  };
});

// Pedidos (painel)
const boardRow = (o: Row) => ({ ...o, items: o.items.map((i: Row) => pick(i, ['name', 'description', 'quantity', 'notes'])) });
on('GET', '/api/admin/orders/board', ({ db }) => {
  const { tenantId } = perm(db, 'orders.view');
  const since = Date.now() - 12 * 3600_000;
  return db.orders
    .filter((o) => o.tenant_id === tenantId && (!['completed', 'cancelled'].includes(o.status) || new Date(o.created_at).getTime() > since))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(boardRow);
});
on('GET', '/api/admin/orders', ({ db, query }) => {
  const { tenantId } = perm(db, 'orders.view');
  let list = db.orders.filter((o) => o.tenant_id === tenantId);
  const st = query.get('status')?.split(',').filter(Boolean);
  if (st?.length) list = list.filter((o) => st.includes(o.status));
  if (query.get('from')) list = list.filter((o) => localDay(o.created_at) >= query.get('from')!);
  if (query.get('to')) list = list.filter((o) => localDay(o.created_at) <= query.get('to')!);
  const q = query.get('q')?.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, '');
    list = /^#?\d{1,7}$/.test(q) ? list.filter((o) => o.number === Number(digits)) : list.filter((o) => o.customer_name.toLowerCase().includes(q) || (digits.length >= 4 && o.customer_phone.includes(digits)));
  }
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const off = Number(query.get('offset') ?? 0), lim = Number(query.get('limit') ?? 50);
  return { orders: list.slice(off, off + lim), total: list.length };
});
const detail = (db: DB, t: string, id: string) => {
  const o = db.orders.find((x) => x.id === id && x.tenant_id === t) ?? fail(404, 'not_found', 'Pedido não encontrado');
  return { ...o!, events: o!.events.map((e: Row) => ({ ...e, user_name: db.users.find((u) => u.id === e.user_id)?.name ?? null })), payments: [] };
};
on('GET', '/api/admin/orders/:id', ({ db, params }) => detail(db, perm(db, 'orders.view').tenantId, params[0]));
on('POST', '/api/admin/orders/:id/status', ({ db, params, body }) => {
  const a = perm(db, 'orders.view');
  const to = body.status as OrderStatus;
  if (!can(a.role, permissionFor(to))) fail(403, 'forbidden', 'Você não tem permissão para esta ação');
  const o = db.orders.find((x) => x.id === params[0] && x.tenant_id === a.tenantId) ?? fail(404, 'not_found', 'Pedido não encontrado');
  if (!canTransition(o!.status, to, o!.fulfillment)) fail(409, 'invalid_transition', `Não é possível mudar de "${STATUS_LABELS[o!.status as OrderStatus]}" para "${STATUS_LABELS[to]}"`);
  if (to === 'cancelled' && !String(body.reason ?? '').trim()) fail(400, 'reason_required', 'Informe o motivo do cancelamento');
  const from = o!.status;
  o!.status = to;
  const col = STATUS_TIMESTAMP[to];
  if (col && !o![col]) o![col] = now();
  addEvent(o!, { type: 'status', from_status: from, to_status: to, user_id: a.user.id, message: to === 'cancelled' ? body.reason : STATUS_LABELS[to] });
  if (to === 'cancelled') {
    o!.cancel_reason = body.reason;
    if (o!.coupon_id) {
      const c = db.coupons.find((x) => x.id === o!.coupon_id);
      if (c) c.used_count = Math.max(0, c.used_count - 1);
    }
    if (o!.payment_status === 'pending') o!.payment_status = 'cancelled';
  }
  if (to === 'completed' && o!.payment_status === 'pending') {
    o!.payment_status = 'paid';
    o!.paid_at = now();
    addEvent(o!, { type: 'payment', user_id: a.user.id, message: 'Pagamento recebido na conclusão' });
  }
  queueMicrotask(() => emit(a.tenantId, o!, 'order.updated'));
  return detail(db, a.tenantId, o!.id);
});
on('POST', '/api/admin/orders/:id/confirm-payment', ({ db, params }) => {
  const a = perm(db, 'payments.confirm');
  const o = db.orders.find((x) => x.id === params[0] && x.tenant_id === a.tenantId) ?? fail(404, 'not_found', 'Pedido não encontrado');
  if (o!.payment_status !== 'pending' || o!.status === 'cancelled') fail(409, 'payment_not_pending', 'Este pedido não está com pagamento pendente');
  o!.payment_status = 'paid';
  o!.paid_at = now();
  addEvent(o!, { type: 'payment', user_id: a.user.id, message: 'Pagamento confirmado pela equipe' });
  queueMicrotask(() => emit(a.tenantId, o!, 'order.updated'));
  return detail(db, a.tenantId, o!.id);
});

// Cardápio, cupons e regiões (CRUD genérico)
for (const [path, table] of [...Object.entries(MENU_TABLES).map(([k, v]) => [`/api/admin/menu/${k}`, v] as const), ['/api/admin/coupons', 'coupons'] as const, ['/api/admin/zones', 'zones'] as const]) {
  const writePerm = table === 'zones' ? 'settings.manage' : 'menu.manage';
  on('GET', path, ({ db }) => {
    const { tenantId } = perm(db, 'orders.view');
    const rows = (db[table] as Row[]).filter((r) => r.tenant_id === tenantId);
    return table === 'coupons' ? rows.sort((a, b) => b.created_at.localeCompare(a.created_at)) : rows.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  });
  on('POST', path, ({ db, body }) => {
    const { tenantId } = perm(db, writePerm);
    if (table === 'coupons') {
      body.code = String(body.code).toUpperCase();
      if (!/^[A-Z0-9_-]{3,30}$/.test(body.code)) fail(400, 'validation', 'Código: 3 a 30 letras/números');
      if (db.coupons.some((c) => c.tenant_id === tenantId && c.code === body.code)) fail(409, 'duplicate', 'Registro duplicado');
    }
    if (!String(body.name ?? body.code ?? '').trim()) fail(400, 'validation', 'Informe o nome');
    const row = { available: true, active: true, sort: 0, ...clean(body), id: uid(), tenant_id: tenantId, ...(table === 'coupons' ? { used_count: 0, created_at: now() } : {}) };
    (db[table] as Row[]).push(row);
    return row;
  });
  on('PATCH', `${path}/:id`, ({ db, params, body }) => {
    const keys = Object.keys(body);
    const onlyAvail = ['flavors', 'crusts', 'products', 'addons'].includes(table) && keys.length > 0 && keys.every((k) => k === 'available');
    const { tenantId } = perm(db, onlyAvail ? 'menu.availability' : writePerm);
    const row = (db[table] as Row[]).find((r) => r.id === params[0] && r.tenant_id === tenantId) ?? fail(404, 'not_found', 'Não encontrado');
    Object.assign(row!, clean(body));
    return row;
  });
  on('DELETE', `${path}/:id`, ({ db, params }) => {
    const { tenantId } = perm(db, writePerm);
    const list = db[table] as Row[];
    const i = list.findIndex((r) => r.id === params[0] && r.tenant_id === tenantId);
    if (i < 0) fail(404, 'not_found', 'Não encontrado');
    list.splice(i, 1);
    return { ok: true };
  });
}
function clean(body: Row) {
  const out = { ...body };
  delete out.id;
  delete out.tenant_id;
  if (out.prices) out.prices = Object.fromEntries(Object.entries(out.prices).filter(([, v]) => v !== null && v !== undefined));
  return out;
}

// Configurações
on('GET', '/api/admin/settings', ({ db }) => {
  const { tenantId } = perm(db, 'orders.view');
  const t = db.tenants.find((x) => x.id === tenantId)!;
  return { ...db.settings[tenantId], slug: t.slug, name: t.name, hours: db.hours.filter((h) => h.tenant_id === tenantId), menu_url: `${location.origin}${import.meta.env.BASE_URL}p/${t.slug}` };
});
on('PUT', '/api/admin/settings', ({ db, body }) => {
  const { tenantId } = perm(db, 'settings.manage');
  const { name, ...rest } = body;
  if (name) db.tenants.find((x) => x.id === tenantId)!.name = name;
  if (rest.whatsapp_phone !== undefined) rest.whatsapp_phone = String(rest.whatsapp_phone).replace(/\D/g, '');
  delete rest.accept_pix_online;
  Object.assign(db.settings[tenantId], Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
  return { ok: true };
});
on('POST', '/api/admin/store-status', ({ db, body }) => {
  const { tenantId } = perm(db, 'cash.manage');
  db.settings[tenantId].manual_status = body.manual_status;
  return { ok: true };
});
on('PUT', '/api/admin/hours', ({ db, body }) => {
  const { tenantId } = perm(db, 'settings.manage');
  db.hours = db.hours.filter((h) => h.tenant_id !== tenantId).concat(body.map((h: Row) => ({ ...h, id: uid(), tenant_id: tenantId })));
  return { ok: true };
});
on('GET', '/api/admin/payment-gateway', ({ db }) => {
  const { tenantId } = perm(db, 'settings.manage');
  return { provider: 'mercadopago', enabled: false, has_access_token: false, has_webhook_secret: false, webhook_url: `https://SEU-DOMINIO/api/webhooks/mercadopago/${tenantId}` };
});
on('PUT', '/api/admin/payment-gateway', () => fail(400, 'demo', 'Indisponível na demonstração: o Pix online exige o servidor real com credenciais do Mercado Pago.'));
on('POST', '/api/admin/uploads', async ({ db, body }) => {
  perm(db, 'menu.manage');
  const file = (body as FormData).get('file') as File;
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) fail(400, 'invalid_image', 'Formato aceito: PNG, JPG ou WEBP');
  if (file.size > 600 * 1024) fail(400, 'file_too_large', 'Na demonstração, use imagens de até 600 KB');
  const url = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(file);
  });
  return { url };
});

// Equipe
on('GET', '/api/admin/team', ({ db }) => {
  const { tenantId } = perm(db, 'team.manage');
  return db.memberships.filter((m) => m.tenant_id === tenantId).map((m) => {
    const u = db.users.find((x) => x.id === m.user_id)!;
    return { id: u.id, name: u.name, email: u.email, role: m.role, active: m.active, created_at: m.created_at, must_change_password: u.must_change_password, role_label: ROLE_LABELS[m.role as Role] };
  });
});
on('POST', '/api/admin/team', async ({ db, body }) => {
  const a = perm(db, 'team.manage');
  if (!canAssignRole(a.role, body.role)) fail(403, 'forbidden', 'Você não pode atribuir este papel');
  if (db.users.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase())) fail(409, 'email_taken', 'Este e-mail já está cadastrado na plataforma');
  const temp = `${token().slice(0, 8)}9a`;
  const id = uid();
  db.users.push({ id, email: body.email, name: body.name, password_hash: await hash(temp), must_change_password: true, created_by_tenant_id: a.tenantId });
  db.memberships.push({ tenant_id: a.tenantId, user_id: id, role: body.role, active: true, created_at: now() });
  return { id, temporary_password: temp };
});
on('PATCH', '/api/admin/team/:id', ({ db, params, body }) => {
  const a = perm(db, 'team.manage');
  if (params[0] === a.user.id) fail(400, 'self_change', 'Você não pode alterar o próprio acesso');
  const m = db.memberships.find((x) => x.tenant_id === a.tenantId && x.user_id === params[0]) ?? fail(404, 'not_found', 'Membro não encontrado');
  if (!canAssignRole(a.role, m!.role) || (body.role && !canAssignRole(a.role, body.role))) fail(403, 'forbidden', 'Você não tem permissão para esta ação');
  if (body.role) m!.role = body.role;
  if (body.active !== undefined) m!.active = body.active;
  return { ok: true };
});
on('POST', '/api/admin/team/:id/reset-password', async ({ db, params }) => {
  const a = perm(db, 'team.manage');
  const u = db.users.find((x) => x.id === params[0]);
  if (!u || u.created_by_tenant_id !== a.tenantId) fail(403, 'forbidden', 'Este usuário deve redefinir a própria senha');
  const temp = `${token().slice(0, 8)}9a`;
  u!.password_hash = await hash(temp);
  u!.must_change_password = true;
  return { temporary_password: temp };
});

// Relatórios
on('GET', '/api/admin/reports/sales', ({ db, query }) => {
  const { tenantId } = perm(db, 'reports.view');
  const from = query.get('from')!, to = query.get('to')!;
  const all = db.orders.filter((o) => o.tenant_id === tenantId && localDay(o.created_at) >= from && localDay(o.created_at) <= to);
  const done = all.filter((o) => o.status === 'completed');
  const canc = all.filter((o) => o.status === 'cancelled');
  const sum = (l: Row[], k: string) => l.reduce((a, o) => a + (o[k] ?? 0), 0);
  const group = <T,>(l: Row[], key: (o: Row) => string, init: () => T, add: (acc: T, o: Row) => void) => {
    const m = new Map<string, T>();
    l.forEach((o) => {
      const k = key(o);
      if (!m.has(k)) m.set(k, init());
      add(m.get(k)!, o);
    });
    return m;
  };
  const byDay = group(all, (o) => localDay(o.created_at), () => ({ orders: 0, revenue_cents: 0 }), (a, o) => {
    if (o.status === 'completed') { a.orders++; a.revenue_cents += o.total_cents; }
  });
  const items = done.flatMap((o) => o.items);
  const flavors = new Map<string, number>();
  items.filter((i) => i.kind === 'pizza').forEach((i) => i.details.flavors.forEach((f: Row) => flavors.set(f.name, (flavors.get(f.name) ?? 0) + i.quantity / i.details.flavors.length)));
  const products = group(items.filter((i) => i.kind === 'product'), (i) => i.name, () => ({ quantity: 0, total_cents: 0 }), (a, i) => { a.quantity += i.quantity; a.total_cents += i.total_cents; });
  const pay = group(done, (o) => o.payment_method, () => ({ orders: 0, total_cents: 0 }), (a, o) => { a.orders++; a.total_cents += o.total_cents; });
  const ful = group(done, (o) => o.fulfillment, () => ({ orders: 0, total_cents: 0 }), (a, o) => { a.orders++; a.total_cents += o.total_cents; });
  const hours = group(done, (o) => String(new Date(o.created_at).getHours()), () => ({ orders: 0 }), (a) => { a.orders++; });
  const coupons = group(done.filter((o) => o.coupon_code), (o) => o.coupon_code, () => ({ orders: 0, discount_cents: 0 }), (a, o) => { a.orders++; a.discount_cents += o.discount_cents; });
  return {
    summary: {
      orders: all.filter((o) => !['cancelled', 'awaiting_payment'].includes(o.status)).length, completed: done.length, revenue_cents: sum(done, 'total_cents'),
      delivery_fees_cents: sum(done, 'delivery_fee_cents'), discounts_cents: sum(done, 'discount_cents'), cancelled: canc.length, cancelled_cents: sum(canc, 'total_cents'),
      avg_ticket_cents: done.length ? Math.round(sum(done, 'total_cents') / done.length) : 0,
      avg_minutes: done.length ? Math.round(done.reduce((a, o) => a + (new Date(o.completed_at).getTime() - new Date(o.created_at).getTime()) / 60000, 0) / done.length) : 0,
    },
    by_day: [...byDay].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    by_payment: [...pay].map(([payment_method, v]) => ({ payment_method, ...v })).sort((a, b) => b.total_cents - a.total_cents),
    by_fulfillment: [...ful].map(([fulfillment, v]) => ({ fulfillment, ...v })),
    by_hour: [...hours].map(([hour, v]) => ({ hour: Number(hour), ...v })).sort((a, b) => a.hour - b.hour),
    top_products: [...products].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    top_flavors: [...flavors].map(([name, pizzas]) => ({ name, pizzas: Math.round(pizzas * 10) / 10 })).sort((a, b) => b.pizzas - a.pizzas).slice(0, 10),
    coupons: [...coupons].map(([coupon_code, v]) => ({ coupon_code, ...v })),
    cancellations: canc.map((o) => pick(o, ['number', 'customer_name', 'total_cents', 'cancel_reason', 'cancelled_at'])),
  };
});

// Caixa
on('GET', '/api/admin/cash/current', ({ db }) => {
  const { tenantId } = perm(db, 'cash.manage');
  const s = db.cash_sessions.find((x) => x.tenant_id === tenantId && x.status === 'open');
  if (!s) return { session: null };
  return { session: { ...s, opened_by_name: db.users.find((u) => u.id === s.opened_by)?.name }, summary: cashSummary(db, tenantId, s) };
});
on('POST', '/api/admin/cash/open', ({ db, body }) => {
  const a = perm(db, 'cash.manage');
  if (db.cash_sessions.some((x) => x.tenant_id === a.tenantId && x.status === 'open')) fail(409, 'cash_open', 'Já existe um caixa aberto');
  const s = { id: uid(), tenant_id: a.tenantId, status: 'open', opened_by: a.user.id, opened_at: now(), opening_cents: body.opening_cents ?? 0 };
  db.cash_sessions.push(s);
  return s;
});
on('POST', '/api/admin/cash/movements', ({ db, body }) => {
  const a = perm(db, 'cash.manage');
  const s = db.cash_sessions.find((x) => x.tenant_id === a.tenantId && x.status === 'open') ?? fail(409, 'cash_closed', 'Abra o caixa primeiro');
  db.cash_movements.push({ id: uid(), tenant_id: a.tenantId, session_id: s!.id, type: body.type, amount_cents: body.amount_cents, reason: body.reason, user_id: a.user.id, created_at: now() });
  return { ok: true };
});
on('POST', '/api/admin/cash/close', ({ db, body }) => {
  const a = perm(db, 'cash.manage');
  const s = db.cash_sessions.find((x) => x.tenant_id === a.tenantId && x.status === 'open') ?? fail(409, 'cash_closed', 'Não há caixa aberto');
  s!.closed_at = now();
  const summary = cashSummary(db, a.tenantId, s!);
  Object.assign(s!, { status: 'closed', closed_by: a.user.id, counted_cents: body.counted_cents, expected_cents: summary.expected_cash_cents, summary, notes: body.notes ?? '' });
  return { session: s, summary, difference_cents: body.counted_cents - summary.expected_cash_cents };
});
const sessionView = (db: DB, s: Row) => ({ ...s, opened_by_name: db.users.find((u) => u.id === s.opened_by)?.name, closed_by_name: db.users.find((u) => u.id === s.closed_by)?.name });
on('GET', '/api/admin/cash/sessions', ({ db }) => {
  const { tenantId } = perm(db, 'cash.manage');
  return db.cash_sessions.filter((s) => s.tenant_id === tenantId).sort((a, b) => b.opened_at.localeCompare(a.opened_at)).map((s) => sessionView(db, s));
});
on('GET', '/api/admin/cash/sessions/:id', ({ db, params }) => {
  const { tenantId } = perm(db, 'cash.manage');
  const s = db.cash_sessions.find((x) => x.id === params[0] && x.tenant_id === tenantId) ?? fail(404, 'not_found', 'Não encontrado');
  return { session: sessionView(db, s!), summary: s!.summary ?? cashSummary(db, tenantId, s!) };
});

function pick(o: Row, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

/** Ponto de entrada usado por lib/api.ts no modo demonstração. */
export async function handle(method: string, fullPath: string, body?: unknown): Promise<{ status: number; body: any }> {
  const [path, qs] = fullPath.split('?');
  const db = await getDb();
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (!match) continue;
    try {
      const res = await h({ db, body: body ?? {}, params: match.slice(1).map(decodeURIComponent), query: new URLSearchParams(qs ?? '') });
      if (method !== 'GET') save(db);
      await new Promise((r) => setTimeout(r, 120)); // latência simulada
      return { status: method === 'POST' && /\/(orders|signup)$/.test(path) ? 201 : 200, body: res };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
      console.error(e);
      return { status: 500, body: { error: { code: 'internal', message: 'Erro interno na demonstração' } } };
    }
  }
  return { status: 404, body: { error: { code: 'not_found', message: 'Rota não disponível na demonstração' } } };
}
