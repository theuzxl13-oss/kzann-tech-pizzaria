import type { Tx } from '../db.js';
import type { Catalog, HalfHalfPricing } from '../domain/pricing.js';

/** Carrega o catálogo do estabelecimento atual (contexto RLS já definido na transação). */
export async function loadCatalog(tx: Tx, halfHalfPricing: HalfHalfPricing): Promise<Catalog> {
  const [sizes, flavors, flavorPrices, crusts, crustPrices, products, addons] = await Promise.all([
    tx.query('SELECT id, name, max_flavors, active FROM pizza_sizes'),
    tx.query('SELECT id, name, active, available FROM pizza_flavors'),
    tx.query('SELECT flavor_id, size_id, price_cents FROM flavor_prices'),
    tx.query('SELECT id, name, active, available FROM crusts'),
    tx.query('SELECT crust_id, size_id, price_cents FROM crust_prices'),
    tx.query('SELECT id, name, price_cents, active, available FROM products'),
    tx.query('SELECT id, name, price_cents, applies_to, active, available FROM addons'),
  ]);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  return {
    halfHalfPricing,
    sizes: byId(sizes.rows),
    flavors: byId(flavors.rows),
    flavorPrices: new Map(flavorPrices.rows.map((r) => [`${r.flavor_id}:${r.size_id}`, r.price_cents])),
    crusts: byId(crusts.rows),
    crustPrices: new Map(crustPrices.rows.map((r) => [`${r.crust_id}:${r.size_id}`, r.price_cents])),
    products: byId(products.rows),
    addons: byId(addons.rows),
  };
}

/** Cardápio público: apenas itens ativos, ordenados. */
export async function loadPublicMenu(tx: Tx) {
  const q = async (sql: string) => (await tx.query(sql)).rows;
  const categories = await q('SELECT id, name, kind FROM categories WHERE active ORDER BY sort, name');
  const sizes = await q('SELECT id, name, slices, max_flavors FROM pizza_sizes WHERE active ORDER BY sort, name');
  const flavors = await q(`
    SELECT f.id, f.category_id, f.name, f.description, f.image_url, f.available,
           COALESCE(json_object_agg(fp.size_id, fp.price_cents) FILTER (WHERE fp.size_id IS NOT NULL), '{}') AS prices
      FROM pizza_flavors f
      LEFT JOIN flavor_prices fp ON fp.flavor_id = f.id
     WHERE f.active
     GROUP BY f.id
     ORDER BY f.sort, f.name`);
  const crusts = await q(`
    SELECT c.id, c.name, c.available,
           COALESCE(json_object_agg(cp.size_id, cp.price_cents) FILTER (WHERE cp.size_id IS NOT NULL), '{}') AS prices
      FROM crusts c
      LEFT JOIN crust_prices cp ON cp.crust_id = c.id
     WHERE c.active
     GROUP BY c.id
     ORDER BY c.sort, c.name`);
  const products = await q(
    'SELECT id, category_id, name, description, image_url, price_cents, available FROM products WHERE active ORDER BY sort, name',
  );
  const addons = await q('SELECT id, name, price_cents, applies_to, available FROM addons WHERE active ORDER BY sort, name');
  return { categories, sizes, flavors, crusts, products, addons };
}
