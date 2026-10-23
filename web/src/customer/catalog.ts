import { priceItem, type Catalog, type CartItemInput } from '../../../server/src/domain/pricing';
import type { PublicMenu } from '../lib/types';

/** Monta o catálogo de preços a partir do cardápio público (mesmas regras do servidor). */
export function catalogFromMenu(m: PublicMenu): Catalog {
  const on = <T extends { available: boolean }>(x: T) => ({ ...x, active: true });
  return {
    halfHalfPricing: m.ordering.half_half_pricing,
    sizes: new Map(m.menu.sizes.map((s) => [s.id, { ...s, active: true }])),
    flavors: new Map(m.menu.flavors.map((f) => [f.id, on(f)])),
    flavorPrices: new Map(m.menu.flavors.flatMap((f) => Object.entries(f.prices).map(([sid, p]) => [`${f.id}:${sid}`, p] as const))),
    crusts: new Map(m.menu.crusts.map((c) => [c.id, on(c)])),
    crustPrices: new Map(m.menu.crusts.flatMap((c) => Object.entries(c.prices).map(([sid, p]) => [`${c.id}:${sid}`, p] as const))),
    products: new Map(m.menu.products.map((p) => [p.id, on(p)])),
    addons: new Map(m.menu.addons.map((a) => [a.id, on(a)])),
  };
}

export function estimate(catalog: Catalog, input: CartItemInput) {
  try {
    return priceItem(catalog, input);
  } catch {
    return null;
  }
}

/** Menor preço de um sabor (para "a partir de"). */
export function fromPrice(prices: Record<string, number>): number | null {
  const v = Object.values(prices);
  return v.length ? Math.min(...v) : null;
}
