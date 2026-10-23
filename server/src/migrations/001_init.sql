-- Kzann Tech Pizzaria — esquema inicial
-- Isolamento multi-tenant: toda tabela de estabelecimento tem tenant_id e política RLS
-- baseada em current_setting('app.tenant_id'), definida por transação pela aplicação.

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- ───────────────────────── Plataforma / identidade ─────────────────────────

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  name               text NOT NULL,
  password_hash      text NOT NULL,
  is_platform_admin  boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  -- Conta de funcionário criada por um estabelecimento (só ele pode redefinir a senha).
  created_by_tenant_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE memberships (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'manager', 'attendant', 'kitchen', 'courier')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    text NOT NULL UNIQUE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ───────────────────────── Configurações do estabelecimento ─────────────────────────

CREATE TABLE tenant_settings (
  tenant_id               uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  description             text NOT NULL DEFAULT '',
  whatsapp_phone          text NOT NULL DEFAULT '',
  address                 text NOT NULL DEFAULT '',
  logo_url                text,
  cover_url               text,
  primary_color           text NOT NULL DEFAULT '#E4572E' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color         text NOT NULL DEFAULT '#1F2937' CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  timezone                text NOT NULL DEFAULT 'America/Sao_Paulo',
  manual_status           text NOT NULL DEFAULT 'auto' CHECK (manual_status IN ('auto', 'open', 'closed')),
  min_order_cents         integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  delivery_enabled        boolean NOT NULL DEFAULT true,
  pickup_enabled          boolean NOT NULL DEFAULT true,
  delivery_eta_minutes    integer NOT NULL DEFAULT 45 CHECK (delivery_eta_minutes BETWEEN 0 AND 600),
  pickup_eta_minutes      integer NOT NULL DEFAULT 25 CHECK (pickup_eta_minutes BETWEEN 0 AND 600),
  half_half_pricing       text NOT NULL DEFAULT 'highest' CHECK (half_half_pricing IN ('highest', 'average')),
  accept_cash             boolean NOT NULL DEFAULT true,
  accept_card_on_delivery boolean NOT NULL DEFAULT true,
  accept_pix_offline      boolean NOT NULL DEFAULT false,
  accept_pix_online       boolean NOT NULL DEFAULT false,
  pix_key                 text NOT NULL DEFAULT '',
  pix_key_holder          text NOT NULL DEFAULT '',
  auto_accept             boolean NOT NULL DEFAULT false,
  whatsapp_template       text NOT NULL DEFAULT 'Olá! 🍕 Faça seu pedido na {pizzaria} pelo nosso cardápio online: {link}',
  order_counter           integer NOT NULL DEFAULT 0,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_gateways (
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('mercadopago')),
  enabled             boolean NOT NULL DEFAULT false,
  access_token_enc    text,
  webhook_secret_enc  text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE TABLE opening_hours (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens      time NOT NULL,
  closes     time NOT NULL
);
CREATE INDEX opening_hours_tenant_idx ON opening_hours (tenant_id, weekday);

CREATE TABLE delivery_zones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               text NOT NULL,
  fee_cents          integer NOT NULL CHECK (fee_cents >= 0),
  neighborhoods      text[] NOT NULL DEFAULT '{}',
  min_order_cents    integer CHECK (min_order_cents >= 0),
  eta_minutes        integer CHECK (eta_minutes BETWEEN 0 AND 600),
  active             boolean NOT NULL DEFAULT true,
  sort               integer NOT NULL DEFAULT 0
);
CREATE INDEX delivery_zones_tenant_idx ON delivery_zones (tenant_id);

-- ───────────────────────── Cardápio ─────────────────────────

CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('pizza', 'product')),
  sort       integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);
CREATE INDEX categories_tenant_idx ON categories (tenant_id);

CREATE TABLE pizza_sizes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slices       integer NOT NULL DEFAULT 8 CHECK (slices BETWEEN 1 AND 32),
  max_flavors  integer NOT NULL DEFAULT 2 CHECK (max_flavors BETWEEN 1 AND 4),
  sort         integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true
);
CREATE INDEX pizza_sizes_tenant_idx ON pizza_sizes (tenant_id);

CREATE TABLE pizza_flavors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  image_url    text,
  sort         integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  available    boolean NOT NULL DEFAULT true
);
CREATE INDEX pizza_flavors_tenant_idx ON pizza_flavors (tenant_id);

CREATE TABLE flavor_prices (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flavor_id    uuid NOT NULL REFERENCES pizza_flavors(id) ON DELETE CASCADE,
  size_id      uuid NOT NULL REFERENCES pizza_sizes(id) ON DELETE CASCADE,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (flavor_id, size_id)
);

CREATE TABLE crusts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort       integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  available  boolean NOT NULL DEFAULT true
);
CREATE INDEX crusts_tenant_idx ON crusts (tenant_id);

CREATE TABLE crust_prices (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  crust_id     uuid NOT NULL REFERENCES crusts(id) ON DELETE CASCADE,
  size_id      uuid NOT NULL REFERENCES pizza_sizes(id) ON DELETE CASCADE,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (crust_id, size_id)
);

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  image_url    text,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  sort         integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  available    boolean NOT NULL DEFAULT true
);
CREATE INDEX products_tenant_idx ON products (tenant_id);

CREATE TABLE addons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  applies_to   text NOT NULL DEFAULT 'pizza' CHECK (applies_to IN ('pizza', 'product', 'all')),
  sort         integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  available    boolean NOT NULL DEFAULT true
);
CREATE INDEX addons_tenant_idx ON addons (tenant_id);

CREATE TABLE coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,30}$'),
  type             text NOT NULL CHECK (type IN ('percent', 'fixed', 'free_delivery')),
  value            integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  min_order_cents  integer NOT NULL DEFAULT 0 CHECK (min_order_cents >= 0),
  max_uses         integer CHECK (max_uses > 0),
  used_count       integer NOT NULL DEFAULT 0,
  starts_at        timestamptz,
  ends_at          timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (type <> 'percent' OR value BETWEEN 1 AND 100)
);

-- ───────────────────────── Clientes e pedidos ─────────────────────────

CREATE TABLE customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  name          text NOT NULL,
  last_address  jsonb,
  orders_count  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number              integer NOT NULL,
  public_token        text NOT NULL UNIQUE,
  customer_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name       text NOT NULL,
  customer_phone      text NOT NULL,
  customer_email      text,
  fulfillment         text NOT NULL CHECK (fulfillment IN ('delivery', 'pickup')),
  address             jsonb,
  delivery_zone_id    uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  status              text NOT NULL CHECK (status IN ('awaiting_payment', 'pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled')),
  payment_method      text NOT NULL CHECK (payment_method IN ('cash', 'card_on_delivery', 'pix_offline', 'pix_online')),
  payment_status      text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'refund_pending', 'cancelled')),
  change_for_cents    integer CHECK (change_for_cents >= 0),
  subtotal_cents      integer NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents  integer NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  discount_cents      integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents         integer NOT NULL CHECK (total_cents >= 0),
  coupon_id           uuid REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_code         text,
  notes               text NOT NULL DEFAULT '',
  eta_minutes         integer,
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz,
  ready_at            timestamptz,
  dispatched_at       timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  paid_at             timestamptz,
  UNIQUE (tenant_id, number)
);
CREATE INDEX orders_tenant_created_idx ON orders (tenant_id, created_at DESC);
CREATE INDEX orders_tenant_status_idx ON orders (tenant_id, status);
CREATE INDEX orders_tenant_phone_idx ON orders (tenant_id, customer_phone);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('pizza', 'product')),
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  details           jsonb NOT NULL DEFAULT '{}',
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  total_cents       integer NOT NULL CHECK (total_cents >= 0),
  notes             text NOT NULL DEFAULT ''
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type         text NOT NULL,
  from_status  text,
  to_status    text,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  message      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id);

CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id             uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  provider_payment_id  text NOT NULL,
  status               text NOT NULL,
  amount_cents         integer NOT NULL,
  qr_code              text,
  qr_code_base64       text,
  ticket_url           text,
  expires_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE webhook_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  event_key    text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, event_key)
);

-- ───────────────────────── Caixa ─────────────────────────

CREATE TABLE cash_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  opening_cents    integer NOT NULL CHECK (opening_cents >= 0),
  closed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at        timestamptz,
  counted_cents    integer,
  expected_cents   integer,
  summary          jsonb,
  notes            text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions (tenant_id) WHERE status = 'open';

CREATE TABLE cash_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('supply', 'withdrawal')),
  amount_cents  integer NOT NULL CHECK (amount_cents > 0),
  reason        text NOT NULL DEFAULT '',
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text,
  entity_id   text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_tenant_idx ON audit_logs (tenant_id, created_at DESC);

-- ───────────────────────── Row Level Security ─────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_settings', 'payment_gateways', 'opening_hours', 'delivery_zones', 'categories',
    'pizza_sizes', 'pizza_flavors', 'flavor_prices', 'crusts', 'crust_prices', 'products',
    'addons', 'coupons', 'customers', 'orders', 'order_items', 'order_events', 'payments',
    'webhook_events', 'cash_sessions', 'cash_movements', 'audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- tenants: dados públicos (nome/slug) legíveis para resolver o link do cardápio;
-- escrita somente no contexto do próprio estabelecimento.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_read ON tenants FOR SELECT USING (true);
CREATE POLICY tenants_insert ON tenants FOR INSERT WITH CHECK (id = app_tenant_id());
CREATE POLICY tenants_update ON tenants FOR UPDATE USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

-- memberships: visível ao estabelecimento atual ou ao próprio usuário (lista de lojas no login).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON memberships FOR SELECT
  USING (tenant_id = app_tenant_id() OR user_id = app_user_id());
CREATE POLICY memberships_write ON memberships FOR INSERT WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_delete ON memberships FOR DELETE USING (tenant_id = app_tenant_id());
