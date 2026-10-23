import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context.js';
import { withTx } from './db.js';
import { randomToken, sha256 } from './lib/crypto.js';
import { forbidden, unauthorized } from './lib/errors.js';
import { can, ROLE_PERMISSIONS, type Permission, type Role } from './lib/permissions.js';

export const SESSION_COOKIE = 'kz_session';
export const CSRF_HEADER = 'x-kzann-csrf';

export interface AuthInfo {
  sessionId: string;
  userId: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  tenantId: string | null;
  role: Role | null;
  permissions: readonly Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthInfo;
  }
}

// Parâmetros recomendados pela OWASP para Argon2id.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, ARGON);
export const verifyPassword = (hashed: string, password: string) => verify(hashed, password).catch(() => false);

/** Hash fictício para igualar o tempo de resposta quando o e-mail não existe. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomToken(16)));

export async function createSession(app: AppContext, req: FastifyRequest, reply: FastifyReply, userId: string, tenantId: string | null) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + app.cfg.SESSION_TTL_HOURS * 3600_000);
  await app.db.query(
    'INSERT INTO sessions (token_hash, user_id, tenant_id, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [sha256(token), userId, tenantId, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300), expires],
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: app.cfg.PUBLIC_BASE_URL.startsWith('https://'),
    expires,
  });
}

export async function destroySession(app: AppContext, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await app.db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Lê a sessão do cookie e resolve usuário + papel no estabelecimento ativo. */
export async function loadAuth(app: AppContext, req: FastifyRequest): Promise<AuthInfo | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const { rows } = await app.db.query(
    `SELECT s.id, s.user_id, s.tenant_id, s.last_seen_at, u.name, u.email, u.active, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const s = rows[0];
  if (!s || !s.active) return null;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
    await app.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [s.id]);
  }
  let role: Role | null = null;
  let tenantId: string | null = null;
  if (s.tenant_id) {
    const m = await withTx(app.db, { tenantId: s.tenant_id, userId: s.user_id }, (tx) =>
      tx.query(
        `SELECT m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
          WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.active AND t.status = 'active'`,
        [s.tenant_id, s.user_id],
      ),
    );
    if (m.rows[0]) {
      role = m.rows[0].role;
      tenantId = s.tenant_id;
    }
  }
  return {
    sessionId: s.id,
    userId: s.user_id,
    name: s.name,
    email: s.email,
    mustChangePassword: s.must_change_password,
    tenantId,
    role,
    permissions: role ? ROLE_PERMISSIONS[role] : [],
  };
}

export type TenantAuth = AuthInfo & { tenantId: string; role: Role };

export function tenantAuth(req: FastifyRequest): TenantAuth {
  const a = req.auth;
  if (!a) throw unauthorized();
  if (!a.tenantId || !a.role) throw forbidden('Selecione uma pizzaria');
  return a as TenantAuth;
}

/** preHandler: exige sessão com estabelecimento ativo e (opcionalmente) uma permissão. */
export function requirePerm(...perms: Permission[]) {
  return async (req: FastifyRequest) => {
    const a = tenantAuth(req);
    if (a.mustChangePassword) throw forbidden('Altere sua senha temporária para continuar');
    for (const p of perms) if (!can(a.role, p)) throw forbidden();
  };
}
