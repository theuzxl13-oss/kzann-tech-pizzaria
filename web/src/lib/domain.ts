// Rótulos e regras compartilhadas com o servidor (mesmo código-fonte de domínio).
export {
  STATUS_LABELS,
  ORDER_STATUSES,
  PAYMENT_LABELS,
  nextStatus,
  canTransition,
  flowFor,
  permissionFor,
  type OrderStatus,
  type PaymentMethod,
  type Fulfillment,
} from '../../../server/src/domain/orderFlow';
export { ROLE_LABELS, ROLES, type Role, type Permission } from '../../../server/src/lib/permissions';

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pagamento pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Devolvido/estornado',
  refund_pending: 'Devolução pendente',
  cancelled: 'Cancelado',
};

export const ACTION_LABELS: Record<string, string> = {
  accepted: 'Aceitar pedido',
  preparing: 'Iniciar preparo',
  ready: 'Marcar como pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluir',
};
