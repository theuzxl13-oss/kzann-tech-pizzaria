/**
 * Regras de preço — código puro, sem I/O. O servidor SEMPRE recalcula o pedido
 * a partir do catálogo do banco; valores enviados pelo cliente são ignorados.
 */

export type HalfHalfPricing = 'highest' | 'average';

interface Sellable {
  id: string;
  name: string;
  active: boolean;
  available: boolean;
}

export interface Catalog {
  halfHalfPricing: HalfHalfPricing;
  sizes: Map<string, { id: string; name: string; max_flavors: number; active: boolean }>;
  flavors: Map<string, Sellable>;
  /** chave `${flavorId}:${sizeId}` */
  flavorPrices: Map<string, number>;
  crusts: Map<string, Sellable>;
  /** chave `${crustId}:${sizeId}` */
  crustPrices: Map<string, number>;
  products: Map<string, Sellable & { price_cents: number }>;
  addons: Map<string, Sellable & { price_cents: number; applies_to: 'pizza' | 'product' | 'all' }>;
}

export type CartItemInput =
  | {
      kind: 'pizza';
      size_id: string;
      flavor_ids: string[];
      crust_id?: string | null;
      addon_ids?: string[];
      quantity: number;
      notes?: string;
    }
  | {
      kind: 'product';
      product_id: string;
      addon_ids?: string[];
      quantity: number;
      notes?: string;
    };

export interface PricedItem {
  kind: 'pizza' | 'product';
  name: string;
  description: string;
  details: Record<string, unknown>;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  notes: string;
}

export class PricingError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const sellable = (x: Sellable | undefined): x is Sellable => !!x && x.active && x.available;

export function fractionLabel(n: number): string {
  return n === 1 ? '' : `1/${n} `;
}

function priceAddons(catalog: Catalog, ids: string[] | undefined, target: 'pizza' | 'product') {
  const unique = [...new Set(ids ?? [])];
  let cents = 0;
  const list: { id: string; name: string; price_cents: number }[] = [];
  for (const id of unique) {
    const addon = catalog.addons.get(id);
    if (!sellable(addon) || (addon.applies_to !== 'all' && addon.applies_to !== target)) {
      throw new PricingError('addon_unavailable', 'Um adicional selecionado não está disponível');
    }
    cents += addon.price_cents;
    list.push({ id, name: addon.name, price_cents: addon.price_cents });
  }
  return { cents, list };
}

export function priceItem(catalog: Catalog, item: CartItemInput): PricedItem {
  const quantity = Math.trunc(item.quantity);
  if (!(quantity >= 1 && quantity <= 99)) throw new PricingError('invalid_quantity', 'Quantidade inválida');
  const notes = (item.notes ?? '').trim().slice(0, 200);

  if (item.kind === 'product') {
    const product = catalog.products.get(item.product_id);
    if (!sellable(product)) throw new PricingError('product_unavailable', 'Um produto do carrinho não está mais disponível');
    const addons = priceAddons(catalog, item.addon_ids, 'product');
    const unit = product.price_cents + addons.cents;
    return {
      kind: 'product',
      name: product.name,
      description: addons.list.map((a) => `+ ${a.name}`).join(' · '),
      details: { product_id: product.id, addons: addons.list },
      quantity,
      unit_price_cents: unit,
      total_cents: unit * quantity,
      notes,
    };
  }

  const size = catalog.sizes.get(item.size_id);
  if (!size || !size.active) throw new PricingError('size_unavailable', 'Tamanho de pizza indisponível');
  const flavorIds = [...new Set(item.flavor_ids)];
  if (flavorIds.length < 1) throw new PricingError('no_flavor', 'Escolha pelo menos um sabor');
  if (flavorIds.length > size.max_flavors) {
    throw new PricingError('too_many_flavors', `O tamanho ${size.name} permite até ${size.max_flavors} sabor(es)`);
  }
  const flavors = flavorIds.map((id) => {
    const flavor = catalog.flavors.get(id);
    const price = catalog.flavorPrices.get(`${id}:${size.id}`);
    if (!sellable(flavor) || price === undefined) {
      throw new PricingError('flavor_unavailable', 'Um sabor selecionado não está disponível neste tamanho');
    }
    return { id, name: flavor.name, price_cents: price };
  });
  const prices = flavors.map((f) => f.price_cents);
  const base =
    catalog.halfHalfPricing === 'highest'
      ? Math.max(...prices)
      : Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  let crust: { id: string; name: string; price_cents: number } | null = null;
  if (item.crust_id) {
    const c = catalog.crusts.get(item.crust_id);
    const price = catalog.crustPrices.get(`${item.crust_id}:${size.id}`);
    if (!sellable(c) || price === undefined) throw new PricingError('crust_unavailable', 'Borda indisponível neste tamanho');
    crust = { id: c.id, name: c.name, price_cents: price };
  }
  const addons = priceAddons(catalog, item.addon_ids, 'pizza');
  const unit = base + (crust?.price_cents ?? 0) + addons.cents;
  const frac = fractionLabel(flavors.length);
  const description = [
    flavors.map((f) => `${frac}${f.name}`).join(', '),
    crust ? `Borda ${crust.name}` : '',
    ...addons.list.map((a) => `+ ${a.name}`),
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    kind: 'pizza',
    name: `Pizza ${size.name}${flavors.length > 1 ? ` (${flavors.length} sabores)` : ''}`,
    description,
    details: {
      size: { id: size.id, name: size.name },
      flavors,
      crust,
      addons: addons.list,
      pricing_rule: catalog.halfHalfPricing,
    },
    quantity,
    unit_price_cents: unit,
    total_cents: unit * quantity,
    notes,
  };
}

// ───────────────────────── Cupons ─────────────────────────

export interface CouponRule {
  code: string;
  type: 'percent' | 'fixed' | 'free_delivery';
  value: number;
  min_order_cents: number;
  max_uses: number | null;
  used_count: number;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  active: boolean;
}

export function couponDiscount(
  coupon: CouponRule,
  subtotalCents: number,
  deliveryFeeCents: number,
  now = new Date(),
): number {
  if (!coupon.active) throw new PricingError('coupon_invalid', 'Cupom inválido');
  if (coupon.starts_at && new Date(coupon.starts_at) > now) throw new PricingError('coupon_not_started', 'Este cupom ainda não está válido');
  if (coupon.ends_at && new Date(coupon.ends_at) < now) throw new PricingError('coupon_expired', 'Este cupom expirou');
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    throw new PricingError('coupon_exhausted', 'Este cupom atingiu o limite de usos');
  }
  if (subtotalCents < coupon.min_order_cents) {
    throw new PricingError('coupon_min_order', `Cupom válido para pedidos a partir de ${formatBRL(coupon.min_order_cents)}`);
  }
  switch (coupon.type) {
    case 'percent':
      return Math.min(subtotalCents, Math.round((subtotalCents * coupon.value) / 100));
    case 'fixed':
      return Math.min(subtotalCents, coupon.value);
    case 'free_delivery':
      if (deliveryFeeCents === 0) throw new PricingError('coupon_no_delivery', 'Cupom de frete grátis vale apenas para entrega');
      return deliveryFeeCents;
  }
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
