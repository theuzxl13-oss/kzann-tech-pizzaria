import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet, useLoad, useToast } from '../components/ui';
import { brl, dateTime, formatPhone, get, post, whatsappLink } from '../lib/api';
import {
  ACTION_LABELS,
  canTransition,
  nextStatus,
  PAYMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  permissionFor,
  STATUS_LABELS,
  type OrderStatus,
} from '../lib/domain';
import { useSession } from './session';

export function statusBadge(status: OrderStatus) {
  const cls: Record<OrderStatus, string> = {
    awaiting_payment: 'warn',
    pending: 'brand',
    accepted: 'info',
    preparing: 'info',
    ready: 'ok',
    out_for_delivery: 'ok',
    completed: '',
    cancelled: 'danger',
  };
  return <span className={`badge ${cls[status]}`}>{STATUS_LABELS[status]}</span>;
}

const CUSTOMER_MSG: Partial<Record<OrderStatus, string>> = {
  accepted: 'seu pedido foi confirmado e já vai para o forno! 🍕',
  preparing: 'sua pizza está sendo preparada. 👨‍🍳',
  ready: 'seu pedido está pronto! ✅',
  out_for_delivery: 'seu pedido saiu para entrega! 🛵',
  completed: 'obrigado pela preferência! 🍕',
  cancelled: 'infelizmente seu pedido foi cancelado.',
};

export function OrderDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const { data: order, reload } = useLoad(() => get(`/api/admin/orders/${id}`), [id]);
  const { can, me } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'ok');
      await reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const move = (status: OrderStatus, r?: string) =>
    act(() => post(`/api/admin/orders/${id}/status`, { status, reason: r }), STATUS_LABELS[status]);

  if (!order) return <Sheet title="Pedido" onClose={onClose}><div className="skeleton" style={{ height: 240 }} /></Sheet>;
  const status = order.status as OrderStatus;
  const next = nextStatus(status, order.fulfillment);
  const canNext = next && can(permissionFor(next));
  const canCancel = canTransition(status, 'cancelled', order.fulfillment) && can('orders.cancel');
  const first = order.customer_name.split(' ')[0];
  const trackUrl = `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/p/${me?.tenant?.slug}/pedido/${order.public_token}`;
  const msg = CUSTOMER_MSG[status];

  return (
    <Sheet
      wide
      title={<span className="row">Pedido #{order.number} {statusBadge(status)}</span>}
      onClose={onClose}
      footer={
        cancelling ? (
          <div className="stack tight">
            <input className="input" autoFocus placeholder="Motivo do cancelamento (o cliente verá)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row">
              <button className="btn ghost grow" onClick={() => setCancelling(false)}>Voltar</button>
              <button className="btn danger grow" disabled={busy || reason.trim().length < 3} onClick={() => move('cancelled', reason).then(() => setCancelling(false))}>
                Confirmar cancelamento
              </button>
            </div>
          </div>
        ) : (
          <div className="row wrap">
            <button className="btn ghost" onClick={() => window.print()}>🖨 Imprimir</button>
            {canCancel && <button className="btn danger" onClick={() => setCancelling(true)}>Cancelar</button>}
            {canNext && (
              <button className="btn primary grow lg" disabled={busy} onClick={() => move(next!)}>
                {ACTION_LABELS[next!]}
              </button>
            )}
          </div>
        )
      }
    >
      <div className="grid2">
        <div className="card flat stack tight">
          <div className="tiny bold muted">CLIENTE</div>
          <div className="bold">{order.customer_name}</div>
          <a href={`tel:${order.customer_phone}`} className="small">{formatPhone(order.customer_phone)}</a>
          <div className="row wrap">
            <a
              className="btn sm ghost"
              target="_blank"
              rel="noreferrer"
              href={whatsappLink(order.customer_phone, `Olá, ${first}! Aqui é da ${me?.tenant?.name}: ${msg ?? ''}\nAcompanhe: ${trackUrl}`)}
            >
              💬 WhatsApp
            </a>
          </div>
        </div>
        <div className="card flat stack tight">
          <div className="tiny bold muted">{order.fulfillment === 'delivery' ? 'ENTREGA' : 'RETIRADA NA LOJA'}</div>
          {order.address ? (
            <>
              <div className="bold">{order.address.street}, {order.address.number}</div>
              <div className="small">{[order.address.complement, order.address.neighborhood].filter(Boolean).join(' · ')}</div>
              {order.address.reference && <div className="small muted">Ref.: {order.address.reference}</div>}
              <a
                className="btn sm ghost"
                target="_blank"
                rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.address.street}, ${order.address.number} - ${order.address.neighborhood}`)}`}
              >
                🗺 Abrir no mapa
              </a>
            </>
          ) : (
            <div className="small muted">Cliente retira no balcão</div>
          )}
        </div>
      </div>

      <div className="stack tight">
        {order.items.map((i: any) => (
          <div key={i.id} className="summary-line">
            <div>
              <span className="bold">{i.quantity}× {i.name}</span>
              {i.description && <div className="small muted">{i.description}</div>}
              {i.notes && <div className="small" style={{ color: 'var(--warn)' }}>⚠ {i.notes}</div>}
            </div>
            <span className="nowrap">{brl(i.total_cents)}</span>
          </div>
        ))}
        {order.notes && <div className="alert small">📝 {order.notes}</div>}
        <hr className="divider" />
        <div className="summary-line small"><span>Subtotal</span><span>{brl(order.subtotal_cents)}</span></div>
        <div className="summary-line small"><span>Entrega</span><span>{brl(order.delivery_fee_cents)}</span></div>
        {order.discount_cents > 0 && <div className="summary-line small"><span>Desconto ({order.coupon_code})</span><span>− {brl(order.discount_cents)}</span></div>}
        <div className="summary-line total"><span>Total</span><span>{brl(order.total_cents)}</span></div>
      </div>

      <div className="card flat row wrap between">
        <div>
          <div className="bold">{PAYMENT_LABELS[order.payment_method as keyof typeof PAYMENT_LABELS]}</div>
          {order.change_for_cents && <div className="small">Troco para {brl(order.change_for_cents)} → levar {brl(order.change_for_cents - order.total_cents)}</div>}
        </div>
        <div className="row">
          <span className={`badge ${order.payment_status === 'paid' ? 'ok' : order.payment_status === 'pending' ? 'warn' : 'danger'}`}>
            {PAYMENT_STATUS_LABELS[order.payment_status]}
          </span>
          {order.payment_status === 'pending' && order.payment_method !== 'pix_online' && status !== 'cancelled' && can('payments.confirm') && (
            <button className="btn sm ok" disabled={busy} onClick={() => act(() => post(`/api/admin/orders/${id}/confirm-payment`), 'Pagamento confirmado')}>
              Confirmar recebimento
            </button>
          )}
        </div>
      </div>
      {status === 'awaiting_payment' && (
        <div className="alert small">Aguardando confirmação do Pix pelo Mercado Pago. O pedido entra na fila automaticamente quando o pagamento for aprovado.</div>
      )}
      {order.payment_status === 'refund_pending' && (
        <div className="alert danger small row between wrap">
          <span>
            {order.payment_method === 'pix_online'
              ? 'Estorno pendente: verifique no painel do Mercado Pago.'
              : `Pedido cancelado após o pagamento: devolva ${brl(order.total_cents)} ao cliente.`}
          </span>
          {can('payments.confirm') && (
            <button className="btn sm dark" disabled={busy} onClick={() => act(() => post(`/api/admin/orders/${id}/confirm-refund`), 'Devolução registrada')}>
              Confirmar devolução
            </button>
          )}
        </div>
      )}

      <details>
        <summary className="bold small" style={{ cursor: 'pointer' }}>Histórico do pedido</summary>
        <div className="stack tight" style={{ marginTop: 10 }}>
          {order.events.map((e: any) => (
            <div key={e.id} className="small row between">
              <span>{e.message ?? (e.to_status ? STATUS_LABELS[e.to_status as OrderStatus] : e.type)}{e.user_name && <span className="muted"> · {e.user_name}</span>}</span>
              <span className="muted nowrap">{dateTime(e.created_at)}</span>
            </div>
          ))}
        </div>
      </details>

      {createPortal(<KitchenTicket order={order} tenantName={me?.tenant?.name ?? ''} />, document.body)}
    </Sheet>
  );
}

/** Comanda para impressora térmica 80mm. */
function KitchenTicket({ order, tenantName }: { order: any; tenantName: string }) {
  return (
    <div className="print-area print-only">
      <h2>{tenantName}</h2>
      <p className="big">#{order.number} · {order.fulfillment === 'delivery' ? 'ENTREGA' : 'RETIRADA'}</p>
      <p className="pc">{dateTime(order.created_at)}</p>
      <hr />
      {order.items.map((i: any) => (
        <div key={i.id} style={{ marginBottom: 4 }}>
          <div className="pl"><strong>{i.quantity}x {i.name}</strong><span>{brl(i.total_cents)}</span></div>
          {i.description && <div>{i.description}</div>}
          {i.notes && <div>** {i.notes}</div>}
        </div>
      ))}
      {order.notes && <><hr /><div>OBS: {order.notes}</div></>}
      <hr />
      <div className="pl"><span>Subtotal</span><span>{brl(order.subtotal_cents)}</span></div>
      <div className="pl"><span>Entrega</span><span>{brl(order.delivery_fee_cents)}</span></div>
      {order.discount_cents > 0 && <div className="pl"><span>Desconto</span><span>-{brl(order.discount_cents)}</span></div>}
      <div className="pl"><strong>TOTAL</strong><strong>{brl(order.total_cents)}</strong></div>
      <div>Pgto: {PAYMENT_LABELS[order.payment_method as keyof typeof PAYMENT_LABELS]} — {PAYMENT_STATUS_LABELS[order.payment_status]}</div>
      {order.change_for_cents && <div>Troco p/ {brl(order.change_for_cents)} (levar {brl(order.change_for_cents - order.total_cents)})</div>}
      <hr />
      <div><strong>{order.customer_name}</strong> · {formatPhone(order.customer_phone)}</div>
      {order.address && (
        <div>
          {order.address.street}, {order.address.number} {order.address.complement}
          <br />
          {order.address.neighborhood} {order.address.reference && `· Ref: ${order.address.reference}`}
        </div>
      )}
      <hr />
      <p className="pc">Não é documento fiscal</p>
    </div>
  );
}
