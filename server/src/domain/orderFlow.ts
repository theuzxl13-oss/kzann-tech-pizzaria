import type { Permission } from '../lib/permissions.js';

export const ORDER_STATUSES = [
  'awaiting_payment',
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: 'Aguardando pagamento',
  pending: 'Novo pedido',
  accepted: 'Aceito',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export type Fulfillment = 'delivery' | 'pickup';
export type PaymentMethod = 'cash' | 'card_on_delivery' | 'pix_offline' | 'pix_online';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  card_on_delivery: 'Cartão na entrega/retirada',
  pix_offline: 'Pix (chave da pizzaria)',
  pix_online: 'Pix online',
};

const FLOW: Record<Fulfillment, OrderStatus[]> = {
  delivery: ['pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'completed'],
  pickup: ['pending', 'accepted', 'preparing', 'ready', 'completed'],
};

export function flowFor(fulfillment: Fulfillment): OrderStatus[] {
  return FLOW[fulfillment];
}

/** Próximo passo "natural" (botão principal do painel). */
export function nextStatus(status: OrderStatus, fulfillment: Fulfillment): OrderStatus | null {
  const flow = FLOW[fulfillment];
  const i = flow.indexOf(status);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

/** Permite avançar para qualquer etapa posterior (ex.: cozinha marca "pronto" direto) ou cancelar. */
export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  if (from === 'completed' || from === 'cancelled') return false;
  if (to === 'cancelled') return true;
  if (from === 'awaiting_payment') return false; // só o webhook de pagamento libera
  const flow = FLOW[fulfillment];
  const a = flow.indexOf(from);
  const b = flow.indexOf(to);
  return a >= 0 && b > a;
}

export function permissionFor(to: OrderStatus): Permission {
  if (to === 'cancelled') return 'orders.cancel';
  if (to === 'out_for_delivery' || to === 'completed') return 'orders.deliver';
  return 'orders.prepare';
}

export const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  accepted: 'accepted_at',
  ready: 'ready_at',
  out_for_delivery: 'dispatched_at',
  completed: 'completed_at',
  cancelled: 'cancelled_at',
};
