import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { migrate } from '../src/migrate.js';
import type { FetchLike } from '../src/payments/mercadopago.js';

/** Sobe um PostgreSQL real e descartável para os testes de integração. */
export async function startTestDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'kzann-test-'));
  const port = 55000 + Math.floor(Math.random() * 2000);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('kzann_test');
  const c = pg.getPgClient();
  await c.connect();
  await c.query("CREATE ROLE kzann_app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS");
  await c.end();
  const adminUrl = `postgres://postgres:postgres@localhost:${port}/kzann_test`;
  const appUrl = `postgres://kzann_app:app@localhost:${port}/kzann_test`;
  await migrate(adminUrl, 'kzann_app');
  return {
    adminUrl,
    appUrl,
    async stop() {
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function startTestApp(
  appUrl: string,
  fetchImpl?: FetchLike,
  opts: { ssePingMs?: number } = {},
): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: appUrl,
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PUBLIC_BASE_URL: 'https://pedidos.example.test',
    SIGNUP_MODE: 'open',
    UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'kzann-up-')),
    WEB_DIST_DIR: path.join(tmpdir(), 'nao-existe'),
  } as NodeJS.ProcessEnv);
  return buildApp(cfg, { fetchImpl, logger: false, ssePingMs: opts.ssePingMs });
}

let nextIp = 1;

/** Cliente HTTP simples que mantém o cookie de sessão (como um navegador). Cada cliente tem um IP próprio. */
export class Client {
  cookie = '';
  constructor(
    private app: FastifyInstance,
    public ip = `10.20.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`,
  ) {}

  async req(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as any,
      url,
      remoteAddress: this.ip,
      payload: body === undefined ? undefined : (body as any),
      headers: { 'x-kzann-csrf': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...extraHeaders },
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const first = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
      this.cookie = first.endsWith('=') ? '' : first;
    }
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* corpo vazio */
    }
    return { status: res.statusCode, body: json };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url);
}

export function expectOk<T = any>(r: { status: number; body: any }, status = 200): T {
  if (r.status !== status) throw new Error(`Esperado HTTP ${status}, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}
