import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, PageLoading, Qty, Sheet, useBrand, useLoad, useToast } from '../components/ui';
import { BASE, brl, get, IS_DEMO, WEEKDAYS, whatsappLink } from '../lib/api';
import { cart, recentOrders, useCart } from '../lib/cart';
import type { Flavor, Product, PublicMenu } from '../lib/types';
import { fromPrice } from './catalog';
import { PizzaBuilder } from './PizzaBuilder';
import { ProductSheet } from './ProductSheet';

export function useStoreMenu(slug: string) {
  const res = useLoad(() => get<PublicMenu>(`/api/public/${slug}`), [slug]);
  useBrand(res.data?.tenant.primary_color);
  useEffect(() => {
    if (!res.data) return;
    document.title = `${res.data.tenant.name} — Cardápio`;
    // PWA por pizzaria: o cliente pode instalar o cardápio da loja na tela inicial.
    if (!IS_DEMO) document.getElementById('manifest')?.setAttribute('href', `${BASE}/api/public/${slug}/manifest.webmanifest`);
  }, [res.data, slug]);
  return res;
}

export function StoreError({ error }: { error: string }) {
  return (
    <div className="auth-page">
      <Empty icon="🔎" title="Não encontramos este cardápio">
        {error}. Confira o link recebido pelo WhatsApp.
      </Empty>
    </div>
  );
}

export function MenuPage() {
  const { slug = '' } = useParams();
  const { data: menu, error, loading } = useStoreMenu(slug);
  const { count, total } = useCart(slug);
  const [builder, setBuilder] = useState<{ flavorId?: string } | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>('');
  const toast = useToast();
  const sections = useRef<Record<string, HTMLElement | null>>({});

  const q = search.trim().toLowerCase();
  const categories = useMemo(() => {
    if (!menu) return [];
    return menu.menu.categories
      .map((c) => ({
        ...c,
        flavors: c.kind === 'pizza' ? menu.menu.flavors.filter((f) => f.category_id === c.id && (!q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q))) : [],
        products: c.kind === 'product' ? menu.menu.products.filter((p) => p.category_id === c.id && (!q || p.name.toLowerCase().includes(q))) : [],
      }))
      .filter((c) => c.flavors.length || c.products.length);
  }, [menu, q]);

  useEffect(() => {
    if (!categories.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActiveCat(vis.target.id.replace('cat-', ''));
      },
      { rootMargin: '-70px 0px -60% 0px' },
    );
    Object.values(sections.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [categories]);

  if (loading && !menu) return <PageLoading />;
  if (error || !menu) return <StoreError error={error ?? 'Erro'} />;

  const t = menu.tenant;
  const open = menu.status.open;
  const recent = recentOrders(slug)[0];
  const added = () => {
    setBuilder(null);
    setProduct(null);
    toast('Adicionado ao carrinho', 'ok');
  };

  return (
    <div className="store">
      <div className="store-cover" style={t.cover_url ? { backgroundImage: `url(${t.cover_url})` } : undefined} />
      <div className="store-head">
        {t.logo_url ? <img className="store-logo" src={t.logo_url} alt="" /> : <div className="store-logo">🍕</div>}
        <div className="grow">
          <h1>{t.name}</h1>
          {t.description && <p className="small muted" style={{ marginTop: 4 }}>{t.description}</p>}
          <div className="store-meta">
            <span className={`badge ${open ? 'ok' : 'danger'}`}>{open ? '● Aberto agora' : '● Fechado'}</span>
            {menu.ordering.delivery_enabled && <span className="badge">🛵 {menu.ordering.delivery_eta_minutes} min</span>}
            {menu.ordering.pickup_enabled && <span className="badge">🏃 Retirada {menu.ordering.pickup_eta_minutes} min</span>}
            {menu.ordering.min_order_cents > 0 && <span className="badge">Mín. {brl(menu.ordering.min_order_cents)}</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setInfoOpen(true)} aria-label="Informações da pizzaria">
          ℹ
        </button>
      </div>

      {!open && (
        <div className="alert closed-banner">
          Estamos fechados no momento. Você pode ver o cardápio, mas os pedidos abrem no nosso horário de funcionamento.
        </div>
      )}
      {recent && (
        <div style={{ margin: '12px 16px 0' }}>
          <Link to={`/p/${slug}/pedido/${recent.token}`} className="alert info row between" style={{ textDecoration: 'none' }}>
            <span>📦 Acompanhar pedido #{recent.number}</span>
            <span>›</span>
          </Link>
        </div>
      )}

      <div className="search">
        <input className="input" placeholder="Buscar no cardápio" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <nav className="cat-tabs" aria-label="Categorias">
        {categories.map((c) => (
          <button
            key={c.id}
            className={activeCat === c.id ? 'on' : ''}
            onClick={() => sections.current[c.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {categories.length === 0 && <Empty title={q ? 'Nada encontrado' : 'Cardápio em preparação'}>{q ? 'Tente outra busca.' : 'Volte em breve!'}</Empty>}

      {categories.map((c) => (
        <section key={c.id} id={`cat-${c.id}`} className="menu-section" ref={(el) => { sections.current[c.id] = el; }}>
          <h2>{c.name}</h2>
          {c.flavors.map((f) => (
            <FlavorCard key={f.id} flavor={f} onClick={() => f.available && setBuilder({ flavorId: f.id })} />
          ))}
          {c.products.map((p) => (
            <button key={p.id} className={`item-card ${p.available ? '' : 'off'}`} onClick={() => p.available && setProduct(p)}>
              <div className="grow">
                <h3>{p.name}</h3>
                {p.description && <p className="desc">{p.description}</p>}
                <span className="price">{p.available ? brl(p.price_cents) : 'Esgotado'}</span>
              </div>
              {p.image_url ? <img className="item-thumb" src={p.image_url} alt="" loading="lazy" /> : <div className="item-thumb">🥤</div>}
            </button>
          ))}
        </section>
      ))}

      {count > 0 && (
        <div className="cart-bar">
          <button className="btn primary" onClick={() => setCartOpen(true)}>
            <span className="row">
              <span className="cart-count">{count}</span> Ver carrinho
            </span>
            <span>{brl(total)}</span>
          </button>
        </div>
      )}

      {builder && <PizzaBuilder menu={menu} initialFlavorId={builder.flavorId} onClose={() => setBuilder(null)} onAdded={added} />}
      {product && <ProductSheet menu={menu} product={product} onClose={() => setProduct(null)} onAdded={added} />}
      {cartOpen && <CartSheet menu={menu} onClose={() => setCartOpen(false)} />}
      {infoOpen && <InfoSheet menu={menu} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

function FlavorCard({ flavor, onClick }: { flavor: Flavor; onClick: () => void }) {
  const price = fromPrice(flavor.prices);
  if (price === null) return null;
  return (
    <button className={`item-card ${flavor.available ? '' : 'off'}`} onClick={onClick}>
      <div className="grow">
        <h3>{flavor.name}</h3>
        {flavor.description && <p className="desc">{flavor.description}</p>}
        <span className="price">{flavor.available ? <>a partir de {brl(price)}</> : 'Esgotado'}</span>
      </div>
      {flavor.image_url ? <img className="item-thumb" src={flavor.image_url} alt="" loading="lazy" /> : <div className="item-thumb">🍕</div>}
    </button>
  );
}

function CartSheet({ menu, onClose }: { menu: PublicMenu; onClose: () => void }) {
  const slug = menu.tenant.slug;
  const { lines, total } = useCart(slug);
  const navigate = useNavigate();
  const belowMin = total < menu.ordering.min_order_cents;
  return (
    <Sheet
      title="Seu carrinho"
      onClose={onClose}
      footer={
        lines.length > 0 && (
          <div className="stack tight">
            {belowMin && <p className="small center muted">Pedido mínimo: {brl(menu.ordering.min_order_cents)}</p>}
            <button
              className="btn primary lg block"
              disabled={!menu.status.open || belowMin}
              onClick={() => navigate(`/p/${slug}/checkout`)}
            >
              {menu.status.open ? `Continuar · ${brl(total)}` : 'Pizzaria fechada no momento'}
            </button>
          </div>
        )
      }
    >
      {lines.length === 0 ? (
        <Empty icon="🛒" title="Seu carrinho está vazio" />
      ) : (
        <div>
          {lines.map((l) => (
            <div key={l.key} className="cart-line">
              <div className="grow">
                <div className="bold">{l.name}</div>
                {l.description && <div className="small muted">{l.description}</div>}
                {l.input.notes && <div className="small muted">Obs.: {l.input.notes}</div>}
                <div className="row between" style={{ marginTop: 8 }}>
                  <Qty value={l.input.quantity} min={0} onChange={(v) => cart.setQuantity(slug, l.key, v)} />
                  <span className="bold">{brl(l.unit_price_cents * l.input.quantity)}</span>
                </div>
              </div>
            </div>
          ))}
          <div className="summary-line total">
            <span>Subtotal</span>
            <span>{brl(total)}</span>
          </div>
          <p className="tiny muted">Taxa de entrega e cupons são calculados na próxima etapa.</p>
        </div>
      )}
    </Sheet>
  );
}

function InfoSheet({ menu, onClose }: { menu: PublicMenu; onClose: () => void }) {
  const t = menu.tenant;
  const byDay = WEEKDAYS.map((d, i) => ({ d, hours: menu.status.hours.filter((h) => h.weekday === i) }));
  return (
    <Sheet title={t.name} onClose={onClose}>
      {t.address && <p>📍 {t.address}</p>}
      {t.whatsapp_phone && (
        <a className="btn ghost" href={whatsappLink(t.whatsapp_phone, `Olá, ${t.name}!`)} target="_blank" rel="noreferrer">
          💬 Falar no WhatsApp
        </a>
      )}
      <section className="stack tight">
        <h4>Horário de funcionamento</h4>
        {byDay.map(({ d, hours }) => (
          <div key={d} className="summary-line small">
            <span>{d}</span>
            <span className={hours.length ? '' : 'muted'}>{hours.length ? hours.map((h) => `${h.opens}–${h.closes}`).join(', ') : 'Fechado'}</span>
          </div>
        ))}
      </section>
      {menu.zones.length > 0 && (
        <section className="stack tight">
          <h4>Taxas de entrega</h4>
          {menu.zones.map((z) => (
            <div key={z.id} className="summary-line small">
              <span>{z.name}{z.neighborhoods.length ? <span className="muted"> · {z.neighborhoods.join(', ')}</span> : null}</span>
              <span className="nowrap">{z.fee_cents ? brl(z.fee_cents) : 'Grátis'}</span>
            </div>
          ))}
        </section>
      )}
      <section className="stack tight">
        <h4>Formas de pagamento</h4>
        <p className="small">{menu.ordering.payment_methods.map((m) => m.label).join(' · ') || '—'}</p>
      </section>
      <p className="tiny muted center">Cardápio digital por Kzann Tech</p>
    </Sheet>
  );
}
