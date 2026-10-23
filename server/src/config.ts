import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  /** URL pública da plataforma (ex.: https://pedidos.kzann.tech). Usada em links, webhooks e checagem de Origin. */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  /** Conexão da aplicação (papel SEM superuser/BYPASSRLS). */
  DATABASE_URL: z.string().min(1),
  /** Conexão usada apenas pelas migrações (dono do schema). Padrão: DATABASE_URL. */
  MIGRATION_DATABASE_URL: z.string().optional(),
  /** Papel do banco que receberá GRANTs após as migrações. */
  DB_APP_ROLE: z.string().regex(/^[a-z_][a-z0-9_]*$/).optional(),
  DB_SSL: bool.default(false),
  /** Chave AES-256 (32 bytes em base64) para criptografar credenciais de gateway. */
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY deve ter 32 bytes em base64'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
  /** open = qualquer pizzaria pode se cadastrar; code = exige SIGNUP_CODE; closed = desativado. */
  SIGNUP_MODE: z.enum(['open', 'code', 'closed']).default('code'),
  SIGNUP_CODE: z.string().optional(),
  UPLOAD_DIR: z.string().default('./uploads'),
  WEB_DIST_DIR: z.string().default('../web/dist'),
  TRUST_PROXY: bool.default(false),
  MERCADOPAGO_API_URL: z.string().url().default('https://api.mercadopago.com'),
  PIX_EXPIRATION_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  /** SMTP para e-mails transacionais (recuperação de senha). Ex.: smtps://usuario:senha@smtp.provedor.com:465 */
  SMTP_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  MAIL_FROM: z.string().default('Kzann Tech <nao-responda@kzann.tech>'),
});

export type Config = z.infer<typeof schema>;

/** Migrar ao iniciar: padrão sim em desenvolvimento/teste e não em produção; MIGRATE_ON_START=true|false força. */
export function shouldMigrateOnStart(cfg: Pick<Config, 'NODE_ENV'>, env: NodeJS.ProcessEnv): boolean {
  const flag = env.MIGRATE_ON_START;
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return cfg.NODE_ENV !== 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.SIGNUP_MODE === 'code' && !cfg.SIGNUP_CODE) {
    throw new Error('SIGNUP_MODE=code exige SIGNUP_CODE');
  }
  return cfg;
}
