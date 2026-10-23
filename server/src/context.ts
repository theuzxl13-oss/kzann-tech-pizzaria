import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { SecretBox } from './lib/crypto.js';
import type { FetchLike } from './payments/mercadopago.js';
import type { RealtimeHub } from './realtime.js';

/** Dependências compartilhadas, injetadas nas rotas e serviços. */
export interface AppContext {
  cfg: Config;
  db: Db;
  hub: RealtimeHub;
  secrets: SecretBox;
  fetchImpl: FetchLike;
  log: FastifyBaseLogger;
}
