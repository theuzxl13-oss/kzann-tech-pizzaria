import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageLoading, useLoad, useToast } from '../components/ui';
import { brl, dateTime, formatPhone, get, whatsappLink } from '../lib/api';
import { flowFor, PAYMENT_LABELS, PAYMENT_STATUS_LABELS, STATUS_LABELS, type OrderStatus } from '../lib/domain';
import { useEventStream } from '../lib/sse';
import { StoreError, useStoreMenu } from './MenuPage';

const STATUS_HERO: Record<OrderStatus, { emoji: string; text: string }> = {
  awaiting_payment: { emoji: '⚡', text: 'Pague o Pix para enviarmos seu pedido à cozinha' },
  pending: { emoji: '📨', text: 'Pedido enviado! Aguardando a pizzaria confirmar.' },
  accepted: { emoji: '👍', text: 'Pedido confirmado pela pizzaria.' },
  preparing: { emoji: '👨‍🍳', text: 'Sua pizza está sendo preparada.' },
  ready: { emoji: '✅', text: 'Pedido pronto!' },
  out_for_delivery: { emoji: '🛵', text: 'Saiu para entrega. Já já chega aí!' },
  completed: { emoji: '🍕', text: 'Pedido concluído. Bom apetite!' },
  cancelled: { emoji: '✖️', text: 'Pedido cancelado.' },
};

export function OrderPage() {
  const { slug = '', token = '' } = useParams();
  const [params] = useSearchParams();
  const store = useStoreMenu(slug);
  const { data: order, error, reload } = useLoad(() => get(`/api/public/${slug}/orders/${token}`), [slug, token]);
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  useEventStream(`/api/public/${slug}/orders/${token}/events`, () => reload());

  if (error) return <StoreError error={error} />;
  if (!order || !store.data) return <PageLoading />;
  const menu = store.data;
  const status = order.status as OrderStatus;
  const hero = STATUS_HERO[status];
  const flow = flowFor(order.fulfillment);
  const currentIdx = flow.indexOf(status);
  const reached = new Map<string, string>(order.timeline.map((t: any) => [t.to_status, t.created_at]));
  const pickupReadyText = order.fulfillment === 'pickup' && status === 'ready' ? 'Pode vir buscar!' : '';

  const summary = [
    `*Pedido #${order.number} — ${menu.tenant.name}*`,
    ...order.items.map((i: any) => `${i.quantity}x ${i.name}${i.description ? ` (${i.description})` : ''}${i.notes ? ` — Obs.: ${i.notes}` : ''}`),
    `Total: ${brl(order.total_cents)} · ${PAYMENT_LABELS[order.payment_method as keyof typeof PAYMENT_LABELS]}`,
    order.fulfillment === 'delivery'
      ? `Entrega: ${order.address.street}, ${order.address.number}${order.address.complement ? ` — ${order.address.complement}` : ''} · ${order.address.neighborhood}`
      : 'Retirada na loja',
    `Acompanhar: ${location.href.split('?')[0]}`,
  ].join('\n');

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(order.pix?.qr_code ?? '');
      setCopied(true);
      toast('Código Pix copiado', 'ok');
    } catch {
      toast('Não foi possível copiar. Selecione o código manualmente.', 'error');
    }
  };

  return (
    <>
      <div className="topbar">
        <Link to={`/p/${slug}`} className="icon-btn" aria-label="Voltar ao cardápio">
          ←
        </Link>
        <h1>Pedido #{order.number}</h1>
        <button className="icon-btn" onClick={() => window.print()} aria-label="Imprimir comprovante">
          🖨
        </button>
      </div>
      <div className="checkout stack">
        {params.get('novo') && status !== 'awaiting_payment' && status !== 'cancelled' && (
          <div className="alert ok">Recebemos seu pedido! Esta página atualiza sozinha a cada etapa.</div>
        )}
        <div className="card status-hero">
          <div className="emoji">{hero.emoji}</div>
          <h2>{STATUS_LABELS[status]}</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            {hero.text} {pickupReadyText}
          </p>
          {status === 'cancelled' && order.cancel_reason && <p className="small" style={{ marginTop: 8 }}>Motivo: {order.cancel_reason}</p>}
          {!['completed', 'cancelled', 'awaiting_payment'].includes(status) && order.eta_minutes && (
            <p className="small bold" style={{ marginTop: 8 }}>Previsão: ~{order.eta_minutes} min a partir do pedido</p>
          )}
        </div>

        {status === 'awaiting_payment' && order.pix && (
          <div className="card pix-box stack">
            <h3 className="section-title" style={{ margin: 0 }}>Pague com Pix</h3>
            {order.pix.qr_code_base64 && <img src={`data:image/png;base64,${order.pix.qr_code_base64}`} alt="QR Code Pix" />}
            <p className="small muted">Ou copie o código "Pix Copia e Cola":</p>
            <div className="copy-code">{order.pix.qr_code}</div>
            <button className="btn primary" onClick={copyPix}>{copied ? 'Copiado ✓' : 'Copiar código Pix'}</button>
            {order.pix.expires_at && <p className="tiny muted">Válido até {dateTime(order.pix.expires_at)}. A confirmação é automática.</p>}
          </div>
        )}

        {status !== 'cancelled' && status !== 'awaiting_payment' && (
          <div className="card">
            <div className="timeline">
              {flow.map((s, i) => {
                const done = i < currentIdx || status === 'completed';
                const current = i === currentIdx && status !== 'completed';
                return (
                  <div key={s} className={`tl-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                    <div className="tl-dot">{done ? '✓' : i + 1}</div>
                    <div className="grow">
                      <div className={done || current ? 'bold' : 'muted'}>{STATUS_LABELS[s]}</div>
                      {reached.get(s) && <div className="tiny muted">{dateTime(reached.get(s)!)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card stack tight">
          <h3 className="section-title" style={{ margin: 0 }}>Itens</h3>
          {order.items.map((i: any, idx: number) => (
            <div key={idx} className="summary-line small">
              <span>
                {i.quantity}× <strong>{i.name}</strong>
                {i.description && <span className="muted"> — {i.description}</span>}
                {i.notes && <div className="tiny muted">Obs.: {i.notes}</div>}
              </span>
              <span className="nowrap">{brl(i.total_cents)}</span>
            </div>
          ))}
          <hr className="divider" />
          <div className="summary-line"><span>Subtotal</span><span>{brl(order.subtotal_cents)}</span></div>
          {order.delivery_fee_cents > 0 && <div className="summary-line"><span>Entrega</span><span>{brl(order.delivery_fee_cents)}</span></div>}
          {order.discount_cents > 0 && <div className="summary-line" style={{ color: 'var(--ok)' }}><span>Desconto {order.coupon_code}</span><span>− {brl(order.discount_cents)}</span></div>}
          <div className="summary-line total"><span>Total</span><span>{brl(order.total_cents)}</span></div>
          <p className="small">
            {PAYMENT_LABELS[order.payment_method as keyof typeof PAYMENT_LABELS]} ·{' '}
            <span className={`badge ${order.payment_status === 'paid' ? 'ok' : ''}`}>{PAYMENT_STATUS_LABELS[order.payment_status]}</span>
          </p>
          {order.change_for_cents && <p className="small muted">Troco para {brl(order.change_for_cents)}</p>}
          {order.payment_method === 'pix_offline' && menu.ordering.pix_key && order.payment_status !== 'paid' && (
            <div className="alert info small">
              Chave Pix: <strong>{menu.ordering.pix_key}</strong>. Envie o comprovante pelo WhatsApp.
            </div>
          )}
          {order.fulfillment === 'delivery' && order.address && (
            <p className="small muted">
              📍 {order.address.street}, {order.address.number}
              {order.address.complement && ` — ${order.address.complement}`} · {order.address.neighborhood}
            </p>
          )}
        </div>

        {menu.tenant.whatsapp_phone && (
          <a className="btn ghost lg" href={whatsappLink(menu.tenant.whatsapp_phone, summary)} target="_blank" rel="noreferrer">
            💬 Falar com a pizzaria no WhatsApp
          </a>
        )}
        <Link to={`/p/${slug}`} className="btn link">Fazer outro pedido</Link>
      </div>

      {/* Comprovante (não fiscal) para impressão */}
      <div className="print-area print-only">
        <h2>{menu.tenant.name}</h2>
        <p className="pc">{menu.tenant.address}</p>
        <hr />
        <p className="big">PEDIDO #{order.number}</p>
        <p className="pc">{dateTime(order.created_at)}</p>
        <p>Cliente: {order.customer_name} · {formatPhone(order.customer_phone)}</p>
        <hr />
        {order.items.map((i: any, idx: number) => (
          <div key={idx}>
            <div className="pl"><span>{i.quantity}x {i.name}</span><span>{brl(i.total_cents)}</span></div>
            {i.description && <div>  {i.description}</div>}
          </div>
        ))}
        <hr />
        <div className="pl"><span>Subtotal</span><span>{brl(order.subtotal_cents)}</span></div>
        <div className="pl"><span>Entrega</span><span>{brl(order.delivery_fee_cents)}</span></div>
        <div className="pl"><span>Desconto</span><span>-{brl(order.discount_cents)}</span></div>
        <div className="pl"><strong>TOTAL</strong><strong>{brl(order.total_cents)}</strong></div>
        <p>Pagamento: {PAYMENT_LABELS[order.payment_method as keyof typeof PAYMENT_LABELS]} ({PAYMENT_STATUS_LABELS[order.payment_status]})</p>
        <hr />
        <p className="pc">COMPROVANTE DE PEDIDO — NÃO É DOCUMENTO FISCAL</p>
      </div>
    </>
  );
}
