import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../../auth.js';
import { requirePerm, tenantAuth } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { withTenant } from '../../db.js';
import { randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { canAssignRole, ROLE_LABELS, ROLES } from '../../lib/permissions.js';
import { audit, getHours, getSettings } from '../../services/tenants.js';
import { idParam } from './crud.js';

const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida');
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || v.startsWith('/uploads/') || v.startsWith('https://'), 'URL de imagem inválida')
  .transform((v) => v || null)
  .nullable();

const settingsSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500),
    whatsapp_phone: z.string().transform((v) => v.replace(/\D/g, '')).refine((v) => v === '' || (v.length >= 10 && v.length <= 13), 'WhatsApp inválido'),
    address: z.string().trim().max(200),
    logo_url: optionalUrl,
    cover_url: optionalUrl,
    primary_color: color,
    secondary_color: color,
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Fuso horário inválido'),
    manual_status: z.enum(['auto', 'open', 'closed']),
    min_order_cents: z.number().int().min(0).max(10_000_000),
    delivery_enabled: z.boolean(),
    pickup_enabled: z.boolean(),
    delivery_eta_minutes: z.number().int().min(0).max(600),
    pickup_eta_minutes: z.number().int().min(0).max(600),
    half_half_pricing: z.enum(['highest', 'average']),
    accept_cash: z.boolean(),
    accept_card_on_delivery: z.boolean(),
    accept_pix_offline: z.boolean(),
    accept_pix_online: z.boolean(),
    pix_key: z.string().trim().max(120),
    pix_key_holder: z.string().trim().max(120),
    auto_accept: z.boolean(),
    whatsapp_template: z.string().trim().max(500),
  })
  .partial();

const hoursSchema = z.array(
  z.object({
    weekday: z.number().int().min(0).max(6),
    opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
).max(42);

const IMAGE_TYPES: { ext: string; mime: string; magic: (b: Buffer) => boolean }[] = [
  { ext: 'png', mime: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

export async function settingsRoutes(f: FastifyInstance, app: AppContext) {
  f.get('/api/admin/settings', { preHandler: requirePerm('orders.view') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const s = await getSettings(tx);
      const t = (await tx.query('SELECT slug, name FROM tenants WHERE id = $1', [a.tenantId])).rows[0];
      const { order_counter: _c, ...settings } = s;
      return {
        ...settings,
        slug: t.slug,
        name: t.name,
        hours: await getHours(tx),
        menu_url: `${app.cfg.PUBLIC_BASE_URL}/p/${t.slug}`,
      };
    });
  });

  f.put('/api/admin/settings', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const a = tenantAuth(req);
    const body = settingsSchema.parse(req.body);
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        const { name, ...rest } = body;
        if (name) await tx.query('UPDATE tenants SET name = $2 WHERE id = $1', [a.tenantId, name]);
        const keys = Object.keys(rest).filter((k) => (rest as any)[k] !== undefined);
        if (keys.length) {
          await tx.query(
            `UPDATE tenant_settings SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now()`,
            keys.map((k) => (rest as any)[k]),
          );
        }
        await audit(tx, a.tenantId, a.userId, 'update', 'tenant_settings', a.tenantId, body);
      },
      a.userId,
    );
    return { ok: true };
  });

  /** Abrir/fechar a loja rapidamente (atendente também pode). */
  f.post('/api/admin/store-status', { preHandler: requirePerm('cash.manage') }, async (req) => {
    const a = tenantAuth(req);
    const { manual_status } = z.object({ manual_status: z.enum(['auto', 'open', 'closed']) }).parse(req.body);
    await withTenant(app.db, a.tenantId, async (tx) => {
      await tx.query('UPDATE tenant_settings SET manual_status = $1, updated_at = now()', [manual_status]);
      await audit(tx, a.tenantId, a.userId, 'store_status', 'tenant_settings', a.tenantId, { manual_status });
    });
    return { ok: true };
  });

  f.put('/api/admin/hours', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const a = tenantAuth(req);
    const hours = hoursSchema.parse(req.body);
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        await tx.query('DELETE FROM opening_hours');
        for (const h of hours) {
          await tx.query('INSERT INTO opening_hours (tenant_id, weekday, opens, closes) VALUES ($1, $2, $3, $4)', [
            a.tenantId, h.weekday, h.opens, h.closes,
          ]);
        }
        await audit(tx, a.tenantId, a.userId, 'update', 'opening_hours', a.tenantId);
      },
      a.userId,
    );
    return { ok: true };
  });

  // ───────── Gateway de pagamento (credenciais criptografadas, nunca retornadas) ─────────
  f.get('/api/admin/payment-gateway', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const gw = (await tx.query("SELECT * FROM payment_gateways WHERE provider = 'mercadopago'")).rows[0];
      return {
        provider: 'mercadopago',
        enabled: gw?.enabled ?? false,
        has_access_token: !!gw?.access_token_enc,
        has_webhook_secret: !!gw?.webhook_secret_enc,
        webhook_url: `${app.cfg.PUBLIC_BASE_URL}/api/webhooks/mercadopago/${a.tenantId}`,
      };
    });
  });

  f.put('/api/admin/payment-gateway', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const a = tenantAuth(req);
    const body = z
      .object({
        enabled: z.boolean(),
        access_token: z.string().trim().min(20).max(300).optional(),
        webhook_secret: z.string().trim().min(8).max(300).optional(),
      })
      .parse(req.body);
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        await tx.query(
          `INSERT INTO payment_gateways (tenant_id, provider, enabled, access_token_enc, webhook_secret_enc)
           VALUES ($1, 'mercadopago', $2, $3, $4)
           ON CONFLICT (tenant_id, provider) DO UPDATE SET enabled = EXCLUDED.enabled,
             access_token_enc = COALESCE(EXCLUDED.access_token_enc, payment_gateways.access_token_enc),
             webhook_secret_enc = COALESCE(EXCLUDED.webhook_secret_enc, payment_gateways.webhook_secret_enc),
             updated_at = now()`,
          [
            a.tenantId,
            body.enabled,
            body.access_token ? app.secrets.encrypt(body.access_token) : null,
            body.webhook_secret ? app.secrets.encrypt(body.webhook_secret) : null,
          ],
        );
        await audit(tx, a.tenantId, a.userId, 'update', 'payment_gateways', 'mercadopago', { enabled: body.enabled });
      },
      a.userId,
    );
    return { ok: true };
  });

  // ───────── Upload de imagens (logo, capa, produtos) ─────────
  f.post('/api/admin/uploads', { preHandler: requirePerm('menu.manage'), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = tenantAuth(req);
    const file = await req.file({ limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest('no_file', 'Envie uma imagem');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('file_too_large', 'Imagem maior que 3 MB');
    const type = IMAGE_TYPES.find((t) => t.magic(buf));
    if (!type) throw badRequest('invalid_image', 'Formato aceito: PNG, JPG ou WEBP');
    const dir = path.resolve(app.cfg.UPLOAD_DIR, a.tenantId);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${type.ext}`;
    await writeFile(path.join(dir, name), buf);
    return reply.code(201).send({ url: `/uploads/${a.tenantId}/${name}` });
  });

  // ───────── Equipe ─────────
  f.get('/api/admin/team', { preHandler: requirePerm('team.manage') }, async (req) => {
    const a = tenantAuth(req);
    return withTenant(app.db, a.tenantId, async (tx) => {
      const { rows } = await tx.query(
        `SELECT u.id, u.name, u.email, m.role, m.active, m.created_at, u.must_change_password
           FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY m.created_at`,
        [a.tenantId],
      );
      return rows.map((r) => ({ ...r, role_label: ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] }));
    });
  });

  /** Cria funcionário com senha temporária (troca obrigatória no primeiro acesso). */
  f.post('/api/admin/team', { preHandler: requirePerm('team.manage') }, async (req, reply) => {
    const a = tenantAuth(req);
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        email: z.string().trim().toLowerCase().email(),
        role: z.enum(ROLES),
      })
      .parse(req.body);
    if (!canAssignRole(a.role, body.role)) throw forbidden('Você não pode atribuir este papel');
    const tempPassword = `${randomToken(6)}9a`;
    const result = await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        // Contas de funcionário pertencem a um único estabelecimento: não vincula e-mails já existentes.
        const existing = (await tx.query('SELECT id FROM users WHERE lower(email) = $1', [body.email])).rows[0];
        if (existing) throw conflict('email_taken', 'Este e-mail já está cadastrado na plataforma');
        const userId = randomUUID();
        await tx.query(
          'INSERT INTO users (id, email, name, password_hash, must_change_password, created_by_tenant_id) VALUES ($1, $2, $3, $4, true, $5)',
          [userId, body.email, body.name, await hashPassword(tempPassword), a.tenantId],
        );
        await tx.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)', [a.tenantId, userId, body.role]);
        await audit(tx, a.tenantId, a.userId, 'create', 'membership', userId, { role: body.role });
        return { userId };
      },
      a.userId,
    );
    return reply.code(201).send({
      id: result.userId,
      // Mostrada uma única vez para o gestor repassar ao funcionário.
      temporary_password: tempPassword,
    });
  });

  f.patch('/api/admin/team/:id', { preHandler: requirePerm('team.manage') }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() }).parse(req.body);
    if (id === a.userId) throw badRequest('self_change', 'Você não pode alterar o próprio acesso');
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        const m = (await tx.query('SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2', [a.tenantId, id])).rows[0];
        if (!m) throw notFound('Membro não encontrado');
        if (!canAssignRole(a.role, m.role) || (body.role && !canAssignRole(a.role, body.role))) throw forbidden();
        await tx.query(
          'UPDATE memberships SET role = COALESCE($3, role), active = COALESCE($4, active) WHERE tenant_id = $1 AND user_id = $2',
          [a.tenantId, id, body.role ?? null, body.active ?? null],
        );
        if (body.active === false) {
          await tx.query('DELETE FROM sessions WHERE user_id = $1 AND tenant_id = $2', [id, a.tenantId]);
        }
        await audit(tx, a.tenantId, a.userId, 'update', 'membership', id, body);
      },
      a.userId,
    );
    return { ok: true };
  });

  /** Gera nova senha temporária para um funcionário. */
  f.post('/api/admin/team/:id/reset-password', { preHandler: requirePerm('team.manage') }, async (req) => {
    const a = tenantAuth(req);
    const { id } = idParam.parse(req.params);
    const temp = `${randomToken(6)}9a`;
    await withTenant(
      app.db,
      a.tenantId,
      async (tx) => {
        const m = (await tx.query('SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2', [a.tenantId, id])).rows[0];
        if (!m) throw notFound('Membro não encontrado');
        if (!canAssignRole(a.role, m.role) || id === a.userId) throw forbidden();
        // Só redefine contas de funcionário criadas por este estabelecimento.
        const u = (await tx.query('SELECT created_by_tenant_id FROM users WHERE id = $1', [id])).rows[0];
        if (u?.created_by_tenant_id !== a.tenantId) throw forbidden('Este usuário deve redefinir a própria senha');
        await tx.query('UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1', [id, await hashPassword(temp)]);
        await tx.query('DELETE FROM sessions WHERE user_id = $1', [id]);
        await audit(tx, a.tenantId, a.userId, 'reset_password', 'user', id);
      },
      a.userId,
    );
    return { temporary_password: temp };
  });
}
