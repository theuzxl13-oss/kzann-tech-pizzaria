import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, MoneyInput, PageLoading, useToast } from '../components/ui';
import { brl, maskPhone, post } from '../lib/api';
import { cart, loadCustomer, rememberOrder, saveCustomer, useCart } from '../lib/cart';
import type { Quote } from '../lib/types';
import { StoreError, useStoreMenu } from './MenuPage';

export function CheckoutPage() {
  const { slug = '' } = useParams();
  const { data: menu, error, loading } = useStoreMenu(slug);
  const { lines } = useCart(slug);
  const navigate = useNavigate();
  const toast = useToast();
  const saved = useMemo(() => loadCustomer() ?? {}, []);

  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [area, setArea] = useState<string>(saved.area ?? ''); // zoneId|bairro
  const [address, setAddress] = useState({ street: saved.street ?? '', number: saved.number ?? '', complement: saved.complement ?? '', reference: saved.reference ?? '' });
  const [name, setName] = useState(saved.name ?? '');
  const [phone, setPhone] = useState(saved.phone ?? '');
  const [email, setEmail] = useState(saved.email ?? '');
  const [payment, setPayment] = useState('');
  const [needChange, setNeedChange] = useState(false);
  const [changeFor, setChangeFor] = useState<number | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Uma chave por tentativa de checkout: reenvios (rede instável, toque duplo) devolvem o mesmo pedido.
  const [idempotencyKey] = useState(() => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, ''));

  useEffect(() => {
    if (!menu) return;
    if (!menu.ordering.delivery_enabled && menu.ordering.pickup_enabled) setFulfillment('pickup');
    if (!payment && menu.ordering.payment_methods[0]) setPayment(menu.ordering.payment_methods[0].id);
  }, [menu, payment]);

  const areas = useMemo(
    () =>
      (menu?.zones ?? []).flatMap((z) =>
        z.neighborhoods.length
          ? z.neighborhoods.map((n) => ({ value: `${z.id}|${n}`, label: n, fee: z.fee_cents }))
          : [{ value: `${z.id}|${z.name}`, label: z.name, fee: z.fee_cents }],
      ).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [menu],
  );
  const [zoneId, neighborhood] = area.split('|');
  const validArea = areas.some((a) => a.value === area);

  // Orçamento oficial calculado pelo servidor
  const quoteKey = JSON.stringify([lines.map((l) => l.input), fulfillment, validArea ? area : '', coupon]);
  useEffect(() => {
    if (!menu || !lines.length) return;
    const ctrl = { cancelled: false };
    const t = setTimeout(async () => {
      try {
        const q = await post<Quote>(`/api/public/${slug}/quote`, {
          items: lines.map((l) => l.input),
          fulfillment,
          delivery_zone_id: fulfillment === 'delivery' && validArea ? zoneId : null,
          neighborhood: fulfillment === 'delivery' && validArea ? neighborhood : null,
          coupon_code: coupon,
        });
        if (!ctrl.cancelled) {
          setQuote(q);
          setQuoteError(null);
          if (coupon && q.coupon_error) {
            toast(q.coupon_error, 'error');
            setCoupon(null);
          }
        }
      } catch (e) {
        if (!ctrl.cancelled) setQuoteError((e as Error).message);
      }
    }, 250);
    return () => {
      ctrl.cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, menu]);

  if (loading && !menu) return <PageLoading />;
  if (error || !menu) return <StoreError error={error ?? 'Erro'} />;
  if (!lines.length) {
    return (
      <div className="checkout">
        <Empty icon="🛒" title="Seu carrinho está vazio">
          <Link to={`/p/${slug}`} className="btn primary" style={{ marginTop: 14 }}>
            Ver cardápio
          </Link>
        </Empty>
      </div>
    );
  }

  const phoneDigits = phone.replace(/\D/g, '');
  const needsEmail = payment === 'pix_online';
  const minOk = !quote || quote.subtotal_cents >= quote.min_order_cents;
  const problems: string[] = [];
  if (name.trim().length < 2) problems.push('Informe seu nome');
  if (phoneDigits.length < 10) problems.push('Informe um telefone/WhatsApp válido');
  if (fulfillment === 'delivery') {
    if (!validArea) problems.push('Selecione o bairro');
    if (address.street.trim().length < 2 || !address.number.trim()) problems.push('Informe rua e número');
  }
  if (!payment) problems.push('Escolha a forma de pagamento');
  if (needsEmail && !/^\S+@\S+\.\S+$/.test(email)) problems.push('Informe um e-mail para o Pix');
  if (needChange && quote && (changeFor ?? 0) < quote.total_cents) problems.push('Troco deve ser maior que o total');
  if (!minOk) problems.push(`Pedido mínimo de ${brl(quote!.min_order_cents)}`);

  const submit = async () => {
    if (problems.length) {
      toast(problems[0], 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await post<{ id: string; number: number; token: string }>(`/api/public/${slug}/orders`, {
        items: lines.map((l) => l.input),
        fulfillment,
        delivery_zone_id: fulfillment === 'delivery' ? zoneId : null,
        neighborhood: fulfillment === 'delivery' ? neighborhood : null,
        address: fulfillment === 'delivery' ? address : null,
        customer: { name: name.trim(), phone: phoneDigits, email: needsEmail ? email.trim() : '' },
        payment_method: payment,
        change_for_cents: payment === 'cash' && needChange ? changeFor : null,
        coupon_code: coupon,
        notes,
        idempotency_key: idempotencyKey,
      });
      saveCustomer({ name, phone, email, area, ...address });
      rememberOrder(slug, { token: res.token, number: res.number, created_at: new Date().toISOString() });
      cart.clear(slug);
      navigate(`/p/${slug}/pedido/${res.token}?novo=1`, { replace: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <Link to={`/p/${slug}`} className="icon-btn" aria-label="Voltar">
          ←
        </Link>
        <h1>Finalizar pedido</h1>
      </div>
      <div className="checkout stack">
        {(menu.ordering.delivery_enabled && menu.ordering.pickup_enabled) && (
          <div className="segmented" role="tablist">
            <button className={fulfillment === 'delivery' ? 'on' : ''} onClick={() => setFulfillment('delivery')}>
              🛵 Entrega
            </button>
            <button className={fulfillment === 'pickup' ? 'on' : ''} onClick={() => setFulfillment('pickup')}>
              🏃 Retirar na loja
            </button>
          </div>
        )}

        <div className="card stack">
          <h3 className="section-title" style={{ margin: 0 }}>Seus dados</h3>
          <Field label="Nome">
            <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Como devemos te chamar?" />
          </Field>
          <Field label="WhatsApp" hint="Usado apenas para contato sobre este pedido.">
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(11) 90000-0000" />
          </Field>
        </div>

        {fulfillment === 'delivery' ? (
          <div className="card stack">
            <h3 className="section-title" style={{ margin: 0 }}>Endereço de entrega</h3>
            {areas.length === 0 ? (
              <div className="alert">Esta pizzaria ainda não cadastrou bairros de entrega. Escolha retirada ou fale com a loja.</div>
            ) : (
              <Field label="Bairro">
                <select className="input" value={validArea ? area : ''} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Selecione…</option>
                  {areas.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label} — {a.fee ? brl(a.fee) : 'grátis'}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="grow">
                <Field label="Rua">
                  <input className="input" autoComplete="address-line1" value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
                </Field>
              </div>
              <div style={{ width: 100 }}>
                <Field label="Número">
                  <input className="input" inputMode="numeric" value={address.number} onChange={(e) => setAddress({ ...address, number: e.target.value })} />
                </Field>
              </div>
            </div>
            <Field label="Complemento">
              <input className="input" placeholder="Apto, bloco, casa…" value={address.complement} onChange={(e) => setAddress({ ...address, complement: e.target.value })} />
            </Field>
            <Field label="Ponto de referência">
              <input className="input" value={address.reference} onChange={(e) => setAddress({ ...address, reference: e.target.value })} />
            </Field>
          </div>
        ) : (
          <div className="card stack tight">
            <h3 className="section-title" style={{ margin: 0 }}>Retirada</h3>
            <p>📍 {menu.tenant.address || 'Endereço informado pela pizzaria'}</p>
            <p className="small muted">Pronto em aproximadamente {menu.ordering.pickup_eta_minutes} minutos.</p>
          </div>
        )}

        <div className="card stack">
          <h3 className="section-title" style={{ margin: 0 }}>Pagamento</h3>
          {menu.ordering.payment_methods.length === 0 && <div className="alert">Nenhuma forma de pagamento disponível.</div>}
          <div className="choice-list">
            {menu.ordering.payment_methods.map((m) => (
              <label key={m.id} className={`option ${payment === m.id ? 'selected' : ''}`}>
                <input type="radio" name="pay" checked={payment === m.id} onChange={() => setPayment(m.id)} />
                <div className="grow">
                  <div className="bold">{{ cash: '💵', card_on_delivery: '💳', pix_offline: '🔑', pix_online: '⚡' }[m.id]} {m.label}</div>
                  <div className="tiny muted">
                    {m.id === 'cash' && 'Pague ao receber'}
                    {m.id === 'card_on_delivery' && 'Maquininha na entrega ou retirada'}
                    {m.id === 'pix_offline' && 'Transfira para a chave Pix da pizzaria; a equipe confirma o recebimento'}
                    {m.id === 'pix_online' && 'QR Code gerado na hora, confirmação automática'}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {payment === 'cash' && (
            <div className="stack tight">
              <label className="check">
                <input type="checkbox" checked={needChange} onChange={(e) => setNeedChange(e.target.checked)} />
                Preciso de troco
              </label>
              {needChange && (
                <Field label="Troco para quanto?">
                  <MoneyInput value={changeFor} onChange={setChangeFor} placeholder="Ex.: 100,00" />
                </Field>
              )}
            </div>
          )}
          {payment === 'pix_offline' && menu.ordering.pix_key && (
            <div className="alert info small">
              Chave Pix: <strong>{menu.ordering.pix_key}</strong>
              {menu.ordering.pix_key_holder && <> · {menu.ordering.pix_key_holder}</>}. Envie o comprovante pelo WhatsApp da pizzaria.
            </div>
          )}
          {needsEmail && (
            <Field label="E-mail (exigido pelo processador do Pix)">
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="card stack">
          <h3 className="section-title" style={{ margin: 0 }}>Cupom e observações</h3>
          {coupon ? (
            <div className="row between">
              <span className="badge ok">🏷 {coupon} aplicado</span>
              <button className="btn link" onClick={() => setCoupon(null)}>Remover</button>
            </div>
          ) : (
            <div className="row">
              <input className="input grow" placeholder="Código do cupom" value={couponInput} onChange={(e) => setCouponInput(e.target.value.toUpperCase())} />
              <button className="btn dark" disabled={couponInput.trim().length < 3} onClick={() => setCoupon(couponInput.trim())}>
                Aplicar
              </button>
            </div>
          )}
          <textarea className="input" maxLength={500} placeholder="Observações para a pizzaria (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="card stack tight">
          <h3 className="section-title" style={{ margin: 0 }}>Resumo</h3>
          {quoteError && <div className="alert danger small">{quoteError}</div>}
          {(quote?.items ?? []).map((i, idx) => (
            <div key={idx} className="summary-line small">
              <span>
                {i.quantity}× {i.name}
                {i.description && <span className="muted"> — {i.description}</span>}
              </span>
              <span className="nowrap">{brl(i.total_cents)}</span>
            </div>
          ))}
          {quote && (
            <>
              <hr className="divider" />
              <div className="summary-line"><span>Subtotal</span><span>{brl(quote.subtotal_cents)}</span></div>
              {fulfillment === 'delivery' && (
                <div className="summary-line"><span>Taxa de entrega</span><span>{validArea ? (quote.delivery_fee_cents ? brl(quote.delivery_fee_cents) : 'Grátis') : '—'}</span></div>
              )}
              {quote.discount_cents > 0 && (
                <div className="summary-line" style={{ color: 'var(--ok)' }}><span>Desconto</span><span>− {brl(quote.discount_cents)}</span></div>
              )}
              <div className="summary-line total"><span>Total</span><span>{brl(quote.total_cents)}</span></div>
              <p className="tiny muted">Previsão: cerca de {quote.eta_minutes} min após a confirmação.</p>
            </>
          )}
        </div>
      </div>

      <div className="cart-bar">
        <button className="btn primary" disabled={submitting || !quote || !menu.status.open} onClick={submit}>
          <span>{submitting ? 'Enviando…' : menu.status.open ? 'Fazer pedido' : 'Pizzaria fechada'}</span>
          <span>{quote ? brl(quote.total_cents) : ''}</span>
        </button>
      </div>
    </>
  );
}
