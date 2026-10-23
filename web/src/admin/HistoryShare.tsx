import { useState } from 'react';
import { Empty, Field, useLoad, useToast } from '../components/ui';
import { absoluteUrl, brl, dateTime, formatPhone, get, whatsappLink } from '../lib/api';
import { ORDER_STATUSES as ORDER_STATUS_OPTIONS, PAYMENT_LABELS, PAYMENT_STATUS_LABELS, STATUS_LABELS, type OrderStatus } from '../lib/domain';
import { OrderDetail, statusBadge } from './OrderDetail';
import { useSession } from './session';

const PAGE = 30;

export function HistoryPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const { data, reload } = useLoad(() => get(`/api/admin/orders?${params}`), [params.toString()]);

  return (
    <>
      <div className="row wrap">
        <input className="input sm" style={{ maxWidth: 260 }} placeholder="Nº do pedido, nome ou telefone" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <select className="input sm" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="">Todos os status</option>
          {ORDER_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <input className="input sm" type="date" style={{ width: 'auto' }} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        <input className="input sm" type="date" style={{ width: 'auto' }} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
      </div>
      <div className="table-wrap">
        {!data ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : data.orders.length === 0 ? (
          <Empty icon="🕘" title="Nenhum pedido encontrado" />
        ) : (
          <table className="table">
            <thead><tr><th>#</th><th>Data</th><th>Cliente</th><th className="hide-mobile">Pagamento</th><th>Status</th><th className="right">Total</th></tr></thead>
            <tbody>
              {data.orders.map((o: any) => (
                <tr key={o.id} className="click" onClick={() => setOpenId(o.id)}>
                  <td className="bold">{o.number}</td>
                  <td className="small nowrap">{dateTime(o.created_at)}</td>
                  <td><div className="ellipsis" style={{ maxWidth: 180 }}>{o.customer_name}</div><div className="tiny muted">{formatPhone(o.customer_phone)}</div></td>
                  <td className="small hide-mobile">{PAYMENT_LABELS[o.payment_method as keyof typeof PAYMENT_LABELS]}<div className="tiny muted">{PAYMENT_STATUS_LABELS[o.payment_status]}</div></td>
                  <td>{statusBadge(o.status as OrderStatus)}</td>
                  <td className="right bold nowrap">{brl(o.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && data.total > PAGE && (
        <div className="row between">
          <button className="btn sm ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anteriores</button>
          <span className="small muted">Página {page + 1} de {Math.ceil(data.total / PAGE)}</span>
          <button className="btn sm ghost" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Próximos →</button>
        </div>
      )}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

/** Divulgação: link do cardápio, mensagem pronta e botão para WhatsApp. */
export function SharePage() {
  const { me } = useSession();
  const { data } = useLoad(() => get('/api/admin/settings'), []);
  const toast = useToast();
  const [phone, setPhone] = useState('');
  if (!data || !me?.tenant) return <div className="skeleton" style={{ height: 200 }} />;
  const link = absoluteUrl(`/p/${me.tenant.slug}`);
  const message = (data.whatsapp_template || '{link}').replaceAll('{pizzaria}', data.name).replaceAll('{link}', link);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copiado!', 'ok');
    } catch {
      toast('Não foi possível copiar', 'error');
    }
  };
  const share = async () => {
    if (navigator.share) await navigator.share({ title: data.name, text: message }).catch(() => {});
    else copy(message);
  };
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card stack">
        <h3 className="section-title" style={{ margin: 0 }}>Link do seu cardápio</h3>
        <div className="copy-code" style={{ fontSize: 15 }}>{link}</div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => copy(link)}>Copiar link</button>
          <a className="btn ghost" href={link} target="_blank" rel="noreferrer">Abrir cardápio</a>
        </div>
        <p className="small muted">
          Dica: no WhatsApp Business, coloque este link na <b>mensagem de saudação</b>, na <b>resposta rápida</b> (ex.: /cardapio) e no <b>perfil da empresa</b>.
        </p>
      </div>
      <div className="card stack">
        <h3 className="section-title" style={{ margin: 0 }}>Mensagem pronta</h3>
        <div className="copy-code" style={{ fontSize: 14, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{message}</div>
        <div className="row wrap">
          <button className="btn dark" onClick={() => copy(message)}>Copiar mensagem</button>
          <button className="btn ghost" onClick={share}>Compartilhar…</button>
          <a className="btn ok" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Enviar pelo WhatsApp</a>
        </div>
        <Field label="Enviar para um número específico">
          <div className="row">
            <input className="input" type="tel" placeholder="(11) 90000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <a className={`btn ok ${phone.replace(/\D/g, '').length < 10 ? 'disabled' : ''}`} href={whatsappLink(phone, message)} target="_blank" rel="noreferrer" aria-disabled={phone.replace(/\D/g, '').length < 10}>
              Enviar
            </a>
          </div>
        </Field>
        <p className="tiny muted">O texto pode ser editado em Configurações → Pedidos (modelo com {'{pizzaria}'} e {'{link}'}).</p>
      </div>
    </div>
  );
}
