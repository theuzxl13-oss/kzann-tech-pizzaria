import { createHmac } from 'node:crypto';
import { safeEqual } from '../lib/crypto.js';

/**
 * Integração com a API oficial do Mercado Pago (Pix).
 * - Criação do pagamento: POST /v1/payments com X-Idempotency-Key.
 * - Confirmação: SOMENTE via webhook assinado (x-signature) seguido de consulta
 *   GET /v1/payments/{id} com o token do estabelecimento. O corpo do webhook nunca é
 *   tomado como verdade.
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */

export type FetchLike = typeof fetch;

export interface PixCharge {
  providerPaymentId: string;
  status: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: Date | null;
}

export interface ProviderPayment {
  id: string;
  status: string; // pending | approved | authorized | in_process | in_mediation | rejected | cancelled | refunded | charged_back
  amountCents: number;
  externalReference: string | null;
}

export class GatewayError extends Error {}

export class MercadoPagoClient {
  constructor(
    private accessToken: string,
    private apiUrl = 'https://api.mercadopago.com',
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async request(path: string, init: RequestInit & { idempotencyKey?: string } = {}) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };
    if (init.idempotencyKey) headers['X-Idempotency-Key'] = init.idempotencyKey;
    const res = await this.fetchImpl(`${this.apiUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new GatewayError(`Mercado Pago ${res.status}: ${body?.message ?? 'erro desconhecido'}`);
    }
    return body;
  }

  async createPixPayment(input: {
    orderId: string;
    amountCents: number;
    description: string;
    payerEmail: string;
    payerName: string;
    notificationUrl: string;
    expiresAt: Date;
  }): Promise<PixCharge> {
    const body = await this.request('/v1/payments', {
      method: 'POST',
      idempotencyKey: `order-${input.orderId}`,
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100,
        description: input.description.slice(0, 250),
        payment_method_id: 'pix',
        external_reference: input.orderId,
        notification_url: input.notificationUrl,
        date_of_expiration: input.expiresAt.toISOString().replace('Z', '+00:00'),
        payer: { email: input.payerEmail, first_name: input.payerName.split(' ')[0] },
      }),
    });
    const tx = body.point_of_interaction?.transaction_data ?? {};
    return {
      providerPaymentId: String(body.id),
      status: String(body.status),
      qrCode: tx.qr_code ?? null,
      qrCodeBase64: tx.qr_code_base64 ?? null,
      ticketUrl: tx.ticket_url ?? null,
      expiresAt: body.date_of_expiration ? new Date(body.date_of_expiration) : input.expiresAt,
    };
  }

  async getPayment(id: string): Promise<ProviderPayment> {
    const body = await this.request(`/v1/payments/${encodeURIComponent(id)}`);
    return {
      id: String(body.id),
      status: String(body.status),
      amountCents: Math.round(Number(body.transaction_amount) * 100),
      externalReference: body.external_reference ?? null,
    };
  }

  async refund(id: string): Promise<void> {
    await this.request(`/v1/payments/${encodeURIComponent(id)}/refunds`, {
      method: 'POST',
      idempotencyKey: `refund-${id}`,
      body: '{}',
    });
  }
}

/**
 * Valida o cabeçalho x-signature ("ts=...,v1=...") do webhook do Mercado Pago.
 * Manifesto: `id:{data.id};request-id:{x-request-id};ts:{ts};`
 */
export function verifyMercadoPagoSignature(params: {
  secret: string;
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const { secret, signatureHeader, requestId, dataId } = params;
  if (!signatureHeader || !dataId) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const tolerance = params.toleranceSeconds ?? 600;
  const tsSeconds = ts.length > 10 ? Number(ts) / 1000 : Number(ts);
  const now = (params.now ?? Date.now()) / 1000;
  if (!Number.isFinite(tsSeconds) || Math.abs(now - tsSeconds) > tolerance) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return safeEqual(expected, v1);
}
