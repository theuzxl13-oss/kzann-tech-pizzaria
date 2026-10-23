import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { Tx } from '../../db.js';
import { badRequest } from '../../lib/errors.js';
import { registerCrud } from './crud.js';

const name = z.string().trim().min(1).max(80);
const description = z.string().trim().max(400);
const cents = z.number().int().min(0).max(10_000_000);
const sort = z.number().int().min(0).max(10_000);
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || v.startsWith('/uploads/') || v.startsWith('https://'), 'URL de imagem inválida')
  .transform((v) => v || null)
  .nullable();

/** Chaves estrangeiras ignoram RLS: garante que a categoria é deste estabelecimento e do tipo certo. */
const checkCategory = (kind: 'pizza' | 'product') => async (tx: Tx, data: any) => {
  if (!data.category_id) return;
  const { rows } = await tx.query('SELECT kind FROM categories WHERE id = $1', [data.category_id]);
  if (!rows[0] || rows[0].kind !== kind) throw badRequest('invalid_category', 'Categoria inválida');
};

export async function menuRoutes(f: FastifyInstance, app: AppContext) {
  registerCrud(f, app, {
    path: '/api/admin/menu/categories',
    table: 'categories',
    schema: z.object({ name, kind: z.enum(['pizza', 'product']), sort: sort.optional(), active: z.boolean().optional() }),
  });

  registerCrud(f, app, {
    path: '/api/admin/menu/sizes',
    table: 'pizza_sizes',
    schema: z.object({
      name,
      slices: z.number().int().min(1).max(32).optional(),
      max_flavors: z.number().int().min(1).max(4),
      sort: sort.optional(),
      active: z.boolean().optional(),
    }),
  });

  registerCrud(f, app, {
    path: '/api/admin/menu/flavors',
    table: 'pizza_flavors',
    availabilityField: true,
    prices: { table: 'flavor_prices', fk: 'flavor_id' },
    beforeWrite: checkCategory('pizza'),
    schema: z.object({
      category_id: z.string().uuid(),
      name,
      description: description.optional(),
      image_url: imageUrl.optional(),
      sort: sort.optional(),
      active: z.boolean().optional(),
      available: z.boolean().optional(),
    }),
  });

  registerCrud(f, app, {
    path: '/api/admin/menu/crusts',
    table: 'crusts',
    availabilityField: true,
    prices: { table: 'crust_prices', fk: 'crust_id' },
    schema: z.object({ name, sort: sort.optional(), active: z.boolean().optional(), available: z.boolean().optional() }),
  });

  registerCrud(f, app, {
    path: '/api/admin/menu/products',
    table: 'products',
    availabilityField: true,
    beforeWrite: checkCategory('product'),
    schema: z.object({
      category_id: z.string().uuid(),
      name,
      description: description.optional(),
      image_url: imageUrl.optional(),
      price_cents: cents,
      sort: sort.optional(),
      active: z.boolean().optional(),
      available: z.boolean().optional(),
    }),
  });

  registerCrud(f, app, {
    path: '/api/admin/menu/addons',
    table: 'addons',
    availabilityField: true,
    schema: z.object({
      name,
      price_cents: cents,
      applies_to: z.enum(['pizza', 'product', 'all']),
      sort: sort.optional(),
      active: z.boolean().optional(),
      available: z.boolean().optional(),
    }),
  });

  registerCrud(f, app, {
    path: '/api/admin/coupons',
    table: 'coupons',
    orderBy: 'created_at DESC',
    schema: z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Código: 3 a 30 letras/números'),
      type: z.enum(['percent', 'fixed', 'free_delivery']),
      value: z.number().int().min(0).max(10_000_000),
      min_order_cents: cents.optional(),
      max_uses: z.number().int().positive().nullable().optional(),
      starts_at: z.string().datetime({ offset: true }).nullable().optional(),
      ends_at: z.string().datetime({ offset: true }).nullable().optional(),
      active: z.boolean().optional(),
    }),
  });

  registerCrud(f, app, {
    path: '/api/admin/zones',
    table: 'delivery_zones',
    perm: 'settings.manage',
    schema: z.object({
      name,
      fee_cents: cents,
      neighborhoods: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
      min_order_cents: cents.nullable().optional(),
      eta_minutes: z.number().int().min(0).max(600).nullable().optional(),
      sort: sort.optional(),
      active: z.boolean().optional(),
    }),
  });
}
