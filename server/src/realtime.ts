import { EventEmitter } from 'node:events';
import pg from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Tx } from './db.js';

/**
 * Tempo real via PostgreSQL LISTEN/NOTIFY + Server-Sent Events.
 * NOTIFY é emitido dentro da transação do pedido e só é entregue no COMMIT,
 * e funciona com várias instâncias do servidor atrás de um balanceador.
 */
export const CHANNEL = 'kz_events';

export interface RealtimeEvent {
  tenantId: string;
  orderId: string;
  type: 'order.created' | 'order.updated' | 'order.paid';
  status: string;
  number?: number;
}

export async function notify(tx: Tx, event: RealtimeEvent): Promise<void> {
  await tx.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
}

export class RealtimeHub extends EventEmitter {
  private client: pg.Client | null = null;
  private stopped = false;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private connectionString: string,
    private ssl = false,
    /** Intervalo do evento "ping" usado pelo cliente para detectar conexão morta. */
    private pingMs = 25_000,
  ) {
    super();
    this.setMaxListeners(0);
  }

  async start(): Promise<void> {
    this.stopped = false;
    const client = new pg.Client({ connectionString: this.connectionString, ssl: this.ssl ? { rejectUnauthorized: true } : undefined });
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        this.emit('event', JSON.parse(msg.payload) as RealtimeEvent);
      } catch {
        /* payload inválido: ignora */
      }
    });
    client.on('error', () => this.reconnect());
    client.on('end', () => this.reconnect());
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.client = client;
  }

  private reconnect() {
    if (this.stopped || this.retry) return;
    this.client = null;
    this.retry = setTimeout(async () => {
      this.retry = null;
      try {
        await this.start();
        this.emit('reconnected');
      } catch {
        this.reconnect();
      }
    }, 2000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    const c = this.client;
    this.client = null;
    if (c) {
      c.removeAllListeners('end');
      await c.end().catch(() => {});
    }
  }

  /** Abre um stream SSE e repassa os eventos que passam no filtro. */
  stream(req: FastifyRequest, reply: FastifyReply, filter: (e: RealtimeEvent) => boolean, map = (e: RealtimeEvent): unknown => e) {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('ready', { at: new Date().toISOString() });
    const onEvent = (e: RealtimeEvent) => {
      if (filter(e)) send(e.type, map(e));
    };
    const onReconnect = () => send('resync', {});
    this.on('event', onEvent);
    this.on('reconnected', onReconnect);
    // Evento nomeado (não comentário) para o navegador conseguir observar e reconectar se parar de chegar.
    const ping = setInterval(() => send('ping', {}), this.pingMs);
    req.raw.on('close', () => {
      clearInterval(ping);
      this.off('event', onEvent);
      this.off('reconnected', onReconnect);
    });
  }
}
