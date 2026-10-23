import { useEffect, useMemo, useState } from 'react';
import { Empty, useLoad, useToast } from '../components/ui';
import { brl, get, minutesSince, post, time } from '../lib/api';
import { ACTION_LABELS, nextStatus, PAYMENT_LABELS, permissionFor, type OrderStatus } from '../lib/domain';
import { useAdmin } from './AdminLayout';
import { OrderDetail, statusBadge } from './OrderDetail';
import { useSession } from './session';

const COLUMNS: { key: string; title: string; statuses: OrderStatus[] }[] = [
  { key: 'new', title: 'Novos', statuses: ['pending', 'awaiting_payment'] },
  { key: 'kitchen', title: 'Em preparo', statuses: ['accepted', 'preparing'] },
  { key: 'ready', title: 'Prontos / Entrega', statuses: ['ready', 'out_for_delivery'] },
  { key: 'done', title: 'Finalizados (12h)', statuses: ['completed', 'cancelled'] },
];

export function OrdersBoard() {
  const { data, reload } = useLoad(() => get<any[]>('/api/admin/orders/board'), []);
  const { subscribe, setPendingCount, soundOn, ring } = useAdmin();
  const { can } = useSession();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState('new');
  const [, tick] = useState(0);

  useEffect(
    () =>
      subscribe((type, d) => {
        if (type === 'order.created' && d?.orderId) setFresh((s) => new Set(s).add(d.orderId));
        reload();
      }),
    [subscribe, reload],
  );
  // Atualiza o "há X min" e recarrega o quadro a cada 30 s como reserva caso o tempo real falhe.
  useEffect(() => {
    const t = setInterval(() => {
      tick((x) => x + 1);
      if (document.visibilityState === 'visible') reload();
    }, 30_000);
    return () => clearInterval(t);
  }, [reload]);
  const pending = (data ?? []).filter((o) => o.status === 'pending');
  useEffect(() => setPendingCount(pending.length), [pending.length, setPendingCount]);
  useEffect(() => {
    if (!soundOn || !pending.length) return;
    const t = setInterval(ring, 20_000);
    return () => clearInterval(t);
  }, [soundOn, pending.length, ring]);

  const grouped = useMemo(
    () => Object.fromEntries(COLUMNS.map((c) => [c.key, (data ?? []).filter((o) => c.statuses.includes(o.status)).sort((a, b) => (c.key === 'done' ? b.created_at.localeCompare(a.created_at) : 0))])),
    [data],
  );

  const quickMove = async (o: any, status: OrderStatus) => {
    try {
      await post(`/api/admin/orders/${o.id}/status`, { status });
      setFresh((s) => {
        const n = new Set(s);
        n.delete(o.id);
        return n;
      });
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (!data) return <div className="skeleton" style={{ height: 300 }} />;

  return (
    <>
      <div className="board-tabs">
        {COLUMNS.map((c) => (
          <button key={c.key} className={`btn sm ${tab === c.key ? 'dark' : 'ghost'}`} onClick={() => setTab(c.key)}>
            {c.title} ({grouped[c.key].length})
          </button>
        ))}
      </div>
      <div className="board">
        {COLUMNS.map((c) => (
          <section key={c.key} className={`board-col ${tab === c.key ? '' : 'hide-mobile'}`}>
            <h3>
              {c.title} <span>{grouped[c.key].length}</span>
            </h3>
            {grouped[c.key].length === 0 && <p className="small muted center" style={{ padding: 20 }}>Nenhum pedido</p>}
            {grouped[c.key].map((o: any) => {
              const next = nextStatus(o.status, o.fulfillment);
              const mins = minutesSince(o.created_at);
              const late = !['completed', 'cancelled'].includes(o.status) && mins > (o.eta_minutes ?? 45);
              return (
                <article
                  key={o.id}
                  className={`order-card ${fresh.has(o.id) || o.status === 'pending' ? 'new' : ''} ${late ? 'late' : ''}`}
                  onClick={() => setOpenId(o.id)}
                >
                  <div className="row between">
                    <span className="num">#{o.number}</span>
                    <span className={`small ${late ? 'bold' : 'muted'}`} style={late ? { color: 'var(--danger)' } : undefined}>
                      {time(o.created_at)} · {mins} min
                    </span>
                  </div>
                  <div className="row between">
                    <span className="bold ellipsis">{o.customer_name}</span>
                    <span className="bold">{brl(o.total_cents)}</span>
                  </div>
                  <div className="order-items">
                    {o.items.slice(0, 4).map((i: any, idx: number) => (
                      <div key={idx} className="ellipsis">{i.quantity}× {i.name}{i.description ? ` — ${i.description}` : ''}</div>
                    ))}
                    {o.items.length > 4 && <div>+ {o.items.length - 4} itens</div>}
                  </div>
                  <div className="row wrap">
                    {statusBadge(o.status)}
                    <span className="badge">{o.fulfillment === 'delivery' ? `🛵 ${o.address?.neighborhood ?? ''}` : '🏃 Retirada'}</span>
                    <span className={`badge ${o.payment_status === 'paid' ? 'ok' : ''}`}>{PAYMENT_LABELS[o.payment_method as keyof typeof PAYMENT_LABELS]}</span>
                  </div>
                  {next && can(permissionFor(next)) && o.status !== 'awaiting_payment' && (
                    <button
                      className={`btn sm ${o.status === 'pending' ? 'primary' : 'dark'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        quickMove(o, next);
                      }}
                    >
                      {ACTION_LABELS[next]}
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      {data.length === 0 && (
        <Empty icon="🧾" title="Nenhum pedido por enquanto">
          Divulgue o link do seu cardápio no WhatsApp. Os pedidos aparecem aqui na hora.
        </Empty>
      )}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}
