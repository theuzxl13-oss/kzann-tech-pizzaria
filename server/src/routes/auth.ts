import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from '../auth.js';
import type { AppContext } from '../context.js';
import { withTx } from '../db.js';
import { safeEqual } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { ROLE_LABELS } from '../lib/permissions.js';

export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letras e números na senha');

const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'www', 'kzann', 'login', 'p', 'static', 'assets', 'uploads']);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'Use letras minúsculas, números e hífen (3 a 50 caracteres)')
  .refine((s) => !RESERVED_SLUGS.has(s), 'Este endereço é reservado');

const signupSchema = z.object({
  pizzeria_name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  whatsapp_phone: z.string().transform((v) => v.replace(/\D/g, '')).optional(),
  signup_code: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

async function listMemberships(app: AppContext, userId: string) {
  const { rows } = await withTx(app.db, { userId }, (tx) =>
    tx.query(
      `SELECT t.id, t.slug, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1 AND m.active AND t.status = 'active' ORDER BY t.name`,
      [userId],
    ),
  );
  return rows.map((r) => ({ ...r, role_label: ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] }));
}

export async function authRoutes(f: FastifyInstance, app: AppContext) {
  f.post('/api/auth/signup', { config: authRateLimit }, async (req, reply) => {
    const body = signupSchema.parse(req.body);
    if (app.cfg.SIGNUP_MODE === 'closed') throw forbidden('Cadastro de novas pizzarias desativado');
    if (app.cfg.SIGNUP_MODE === 'code' && !safeEqual(body.signup_code ?? '', app.cfg.SIGNUP_CODE ?? '')) {
      throw forbidden('Código de cadastro inválido');
    }
    const exists = await app.db.query('SELECT 1 FROM users WHERE lower(email) = $1', [body.email]);
    if (exists.rows.length) throw conflict('email_taken', 'Este e-mail já está cadastrado. Faça login.');
    const slugTaken = await app.db.query('SELECT 1 FROM tenants WHERE slug = $1', [body.slug]);
    if (slugTaken.rows.length) throw conflict('slug_taken', 'Este endereço de cardápio já está em uso');

    const passwordHash = await hashPassword(body.password);
    const tenantId = randomUUID();
    const userId = randomUUID();
    await withTx(app.db, { tenantId, userId }, async (tx) => {
      await tx.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [
        userId, body.email, body.name, passwordHash,
      ]);
      await tx.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [tenantId, body.slug, body.pizzeria_name]);
      await tx.query('INSERT INTO tenant_settings (tenant_id, whatsapp_phone) VALUES ($1, $2)', [tenantId, body.whatsapp_phone ?? '']);
      await tx.query("INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, userId]);
      // Estrutura inicial editável (sem preços): o dono completa o cardápio no painel.
      await tx.query(
        `INSERT INTO pizza_sizes (tenant_id, name, slices, max_flavors, sort) VALUES
           ($1, 'Broto', 4, 1, 1), ($1, 'Média', 6, 2, 2), ($1, 'Grande', 8, 2, 3), ($1, 'Gigante', 12, 3, 4)`,
        [tenantId],
      );
      await tx.query(
        `INSERT INTO categories (tenant_id, name, kind, sort) VALUES
           ($1, 'Pizzas Tradicionais', 'pizza', 1), ($1, 'Pizzas Especiais', 'pizza', 2),
           ($1, 'Pizzas Doces', 'pizza', 3), ($1, 'Bebidas', 'product', 4)`,
        [tenantId],
      );
      for (let d = 0; d <= 6; d++) {
        if (d === 1) continue; // segunda-feira fechado por padrão
        await tx.query("INSERT INTO opening_hours (tenant_id, weekday, opens, closes) VALUES ($1, $2, '18:00', '23:30')", [tenantId, d]);
      }
    });
    await createSession(app, req, reply, userId, tenantId);
    return reply.code(201).send({ ok: true, tenant: { id: tenantId, slug: body.slug } });
  });

  f.post('/api/auth/login', { config: authRateLimit }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const { rows } = await app.db.query('SELECT id, password_hash, active FROM users WHERE lower(email) = $1', [body.email]);
    const user = rows[0];
    const ok = await verifyPassword(user?.password_hash ?? (await getDummyHash()), body.password);
    if (!user || !ok || !user.active) throw unauthorized('E-mail ou senha incorretos');
    const tenants = await listMemberships(app, user.id);
    await createSession(app, req, reply, user.id, tenants.length === 1 ? tenants[0].id : null);
    return { ok: true, tenants };
  });

  f.post('/api/auth/logout', async (req, reply) => {
    await destroySession(app, req, reply);
    return { ok: true };
  });

  f.get('/api/auth/me', async (req) => {
    const a = req.auth;
    if (!a) throw unauthorized();
    const tenants = await listMemberships(app, a.userId);
    const current = tenants.find((t) => t.id === a.tenantId) ?? null;
    return {
      user: { id: a.userId, name: a.name, email: a.email, must_change_password: a.mustChangePassword },
      tenant: current,
      role: a.role,
      permissions: a.permissions,
      tenants,
    };
  });

  f.post('/api/auth/switch-tenant', async (req) => {
    const a = req.auth;
    if (!a) throw unauthorized();
    const { tenant_id } = z.object({ tenant_id: z.string().uuid() }).parse(req.body);
    const tenants = await listMemberships(app, a.userId);
    if (!tenants.some((t) => t.id === tenant_id)) throw forbidden('Você não faz parte desta pizzaria');
    await app.db.query('UPDATE sessions SET tenant_id = $2 WHERE id = $1', [a.sessionId, tenant_id]);
    return { ok: true };
  });

  f.post('/api/auth/change-password', { config: authRateLimit }, async (req) => {
    const a = req.auth;
    if (!a) throw unauthorized();
    const body = z.object({ current_password: z.string(), new_password: passwordSchema }).parse(req.body);
    const { rows } = await app.db.query('SELECT password_hash FROM users WHERE id = $1', [a.userId]);
    if (!(await verifyPassword(rows[0].password_hash, body.current_password))) {
      throw badRequest('wrong_password', 'Senha atual incorreta');
    }
    await app.db.query(
      'UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1',
      [a.userId, await hashPassword(body.new_password)],
    );
    // Encerra as demais sessões do usuário.
    await app.db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [a.userId, a.sessionId]);
    return { ok: true };
  });
}
