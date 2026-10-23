import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { CSRF_HEADER, loadAuth } from './auth.js';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { createPool } from './db.js';
import { SecretBox } from './lib/crypto.js';
import { AppError } from './lib/errors.js';
import type { FetchLike } from './payments/mercadopago.js';
import { RealtimeHub } from './realtime.js';
import { menuRoutes } from './routes/admin/menu.js';
import { orderRoutes } from './routes/admin/orders.js';
import { reportRoutes } from './routes/admin/reports.js';
import { settingsRoutes } from './routes/admin/settings.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { webhookRoutes } from './routes/webhooks.js';

export interface BuildOptions {
  fetchImpl?: FetchLike;
  logger?: boolean;
  ssePingMs?: number;
}

export async function buildApp(cfg: Config, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const f = Fastify({
    logger: opts.logger ?? (cfg.NODE_ENV !== 'test' ? { level: cfg.NODE_ENV === 'production' ? 'info' : 'debug' } : false),
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 512 * 1024,
  });

  const db = createPool(cfg.DATABASE_URL, cfg.DB_SSL);
  const hub = new RealtimeHub(cfg.DATABASE_URL, cfg.DB_SSL, opts.ssePingMs);
  await hub.start();
  const ctx: AppContext = {
    cfg,
    db,
    hub,
    secrets: new SecretBox(cfg.ENCRYPTION_KEY),
    fetchImpl: opts.fetchImpl ?? fetch,
    log: f.log,
  };

  await f.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: cfg.PUBLIC_BASE_URL.startsWith('https://'),
  });
  await f.register(cookie);
  await f.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await f.register(multipart);

  // Erros padronizados em JSON { error: { code, message, details } }.
  f.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({
        error: { code: 'validation', message: first?.message ?? 'Dados inválidos', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err?.code === '23505') {
      return reply.code(409).send({ error: { code: 'duplicate', message: 'Registro duplicado' } });
    }
    if (err?.code === '23503') {
      return reply.code(409).send({ error: { code: 'in_use', message: 'Item em uso por outros registros' } });
    }
    if (err?.code === '22P02' || err?.code === '23514') {
      return reply.code(400).send({ error: { code: 'invalid', message: 'Dados inválidos' } });
    }
    if (err?.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code ?? 'error', message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Erro interno. Tente novamente.' } });
  });

  // Autenticação + proteção CSRF (cabeçalho customizado obrigatório em requisições que alteram estado).
  f.addHook('onRequest', async (req) => {
    const url = req.url;
    const isPrivate = url.startsWith('/api/admin') || url.startsWith('/api/auth');
    if (!isPrivate) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new AppError(403, 'csrf', 'Requisição bloqueada');
    }
    const auth = await loadAuth(ctx, req);
    if (auth) req.auth = auth;
    else if (url.startsWith('/api/admin')) throw new AppError(401, 'unauthorized', 'Faça login para continuar');
  });

  f.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  await authRoutes(f, ctx);
  await publicRoutes(f, ctx);
  await webhookRoutes(f, ctx);
  await orderRoutes(f, ctx);
  await menuRoutes(f, ctx);
  await settingsRoutes(f, ctx);
  await reportRoutes(f, ctx);

  // Imagens enviadas
  const uploadDir = path.resolve(cfg.UPLOAD_DIR);
  await mkdir(uploadDir, { recursive: true });
  await f.register(fastifyStatic, {
    root: uploadDir,
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '30d',
    immutable: true,
  });

  // Frontend (PWA) compilado — SPA com fallback para index.html
  const webDist = path.resolve(cfg.WEB_DIST_DIR);
  if (existsSync(webDist)) {
    await f.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    f.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Não encontrado' } });
      }
      return reply.type('text/html').sendFile('index.html', webDist);
    });
  }

  f.addHook('onClose', async () => {
    await hub.stop();
    await db.end();
  });

  return { app: f, ctx };
}
