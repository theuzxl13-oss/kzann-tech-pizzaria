import { useState } from 'react';
import { Empty, useLoad } from '../components/ui';
import { brl, dateTime, get } from '../lib/api';
import { PAYMENT_LABELS } from '../lib/domain';

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function ReportsPage() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const { data, loading, error } = useLoad(() => get(`/api/admin/reports/sales?from=${from}&to=${to}`), [from, to]);

  const preset = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days + 1);
    setFrom(iso(d));
    setTo(iso(new Date()));
  };

  const exportCsv = () => {
    if (!data) return;
    const rows = [['Dia', 'Pedidos concluídos', 'Faturamento (R$)'], ...data.by_day.map((d: any) => [d.day, d.orders, (d.revenue_cents / 100).toFixed(2).replace('.', ',')])];
    const csv = '﻿' + rows.map((r) => r.join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `vendas_${from}_${to}.csv`;
    a.click();
  };

  const s = data?.summary;
  const maxDay = Math.max(1, ...(data?.by_day ?? []).map((d: any) => d.revenue_cents));
  const maxFlavor = Math.max(1, ...(data?.top_flavors ?? []).map((f: any) => f.pizzas));
  const maxProduct = Math.max(1, ...(data?.top_products ?? []).map((f: any) => f.quantity));
  const maxHour = Math.max(1, ...(data?.by_hour ?? []).map((h: any) => h.orders));

  return (
    <>
      <div className="row wrap">
        <input className="input sm" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
        <span>até</span>
        <input className="input sm" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
        <button className="btn sm ghost" onClick={() => preset(1)}>Hoje</button>
        <button className="btn sm ghost" onClick={() => preset(7)}>7 dias</button>
        <button className="btn sm ghost" onClick={() => preset(30)}>30 dias</button>
        <button className="btn sm dark" onClick={exportCsv} disabled={!data}>Exportar CSV</button>
      </div>
      {error && <div className="alert danger">{error}</div>}
      {loading && !data && <div className="skeleton" style={{ height: 200 }} />}
      {s && (
        <>
          <div className="kpis">
            <Kpi label="Faturamento" value={brl(s.revenue_cents)} />
            <Kpi label="Pedidos concluídos" value={String(s.completed)} />
            <Kpi label="Ticket médio" value={brl(s.avg_ticket_cents)} />
            <Kpi label="Tempo médio" value={`${s.avg_minutes} min`} />
            <Kpi label="Taxas de entrega" value={brl(s.delivery_fees_cents)} />
            <Kpi label="Descontos" value={brl(s.discounts_cents)} />
            <Kpi label="Cancelados" value={`${s.cancelled} · ${brl(s.cancelled_cents)}`} />
            <Kpi label="Pedidos recebidos" value={String(s.orders)} />
          </div>

          <div className="card">
            <h3 className="section-title">Faturamento por dia</h3>
            {data.by_day.length === 0 ? (
              <Empty icon="📊" title="Sem vendas no período" />
            ) : (
              <div className="bars" style={{ marginBottom: 24 }}>
                {data.by_day.map((d: any) => (
                  <div key={d.day} className="bar" style={{ height: `${(d.revenue_cents / maxDay) * 100}%` }} title={`${d.day}: ${brl(d.revenue_cents)} (${d.orders} pedidos)`}>
                    <span>{d.day.slice(8, 10)}/{d.day.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid2" style={{ alignItems: 'start' }}>
            <div className="card">
              <h3 className="section-title">Sabores mais vendidos</h3>
              {data.top_flavors.map((f: any) => <HBar key={f.name} label={f.name} value={f.pizzas} max={maxFlavor} text={`${f.pizzas.toLocaleString('pt-BR')} pizzas`} />)}
              {!data.top_flavors.length && <p className="muted small">—</p>}
            </div>
            <div className="card">
              <h3 className="section-title">Produtos mais vendidos</h3>
              {data.top_products.map((p: any) => <HBar key={p.name} label={p.name} value={p.quantity} max={maxProduct} text={`${p.quantity} un.`} />)}
              {!data.top_products.length && <p className="muted small">—</p>}
            </div>
            <div className="card">
              <h3 className="section-title">Formas de pagamento</h3>
              {data.by_payment.map((p: any) => (
                <div key={p.payment_method} className="summary-line">
                  <span>{PAYMENT_LABELS[p.payment_method as keyof typeof PAYMENT_LABELS]} <span className="muted small">({p.orders})</span></span>
                  <b>{brl(p.total_cents)}</b>
                </div>
              ))}
              <hr className="divider" />
              {data.by_fulfillment.map((p: any) => (
                <div key={p.fulfillment} className="summary-line">
                  <span>{p.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'} <span className="muted small">({p.orders})</span></span>
                  <b>{brl(p.total_cents)}</b>
                </div>
              ))}
            </div>
            <div className="card">
              <h3 className="section-title">Pedidos por horário</h3>
              {data.by_hour.map((h: any) => <HBar key={h.hour} label={`${String(h.hour).padStart(2, '0')}h`} value={h.orders} max={maxHour} text={String(h.orders)} />)}
              {!data.by_hour.length && <p className="muted small">—</p>}
            </div>
          </div>

          {data.coupons.length > 0 && (
            <div className="card">
              <h3 className="section-title">Cupons utilizados</h3>
              {data.coupons.map((c: any) => (
                <div key={c.coupon_code} className="summary-line"><span>{c.coupon_code} <span className="muted small">({c.orders} pedidos)</span></span><b>− {brl(c.discount_cents)}</b></div>
              ))}
            </div>
          )}

          <div className="card">
            <h3 className="section-title">Cancelamentos</h3>
            {data.cancellations.length === 0 ? (
              <p className="muted small">Nenhum cancelamento no período 🎉</p>
            ) : (
              data.cancellations.map((c: any) => (
                <div key={c.number} className="summary-line small">
                  <span>#{c.number} · {c.customer_name} — <span className="muted">{c.cancel_reason}</span></span>
                  <span className="nowrap">{brl(c.total_cents)} · {dateTime(c.cancelled_at)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function HBar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  return (
    <div className="hbar">
      <span className="ellipsis">{label}</span>
      <div className="track"><div className="fill" style={{ width: `${(value / max) * 100}%` }} /></div>
      <span className="right small">{text}</span>
    </div>
  );
}
