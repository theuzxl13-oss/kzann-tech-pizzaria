import { useMemo, useState } from 'react';
import { Qty, Sheet } from '../components/ui';
import { brl } from '../lib/api';
import { cart } from '../lib/cart';
import type { PublicMenu } from '../lib/types';
import { catalogFromMenu, estimate } from './catalog';

/** Montagem da pizza: tamanho → sabores (meio a meio) → borda → adicionais → observação. */
export function PizzaBuilder({
  menu,
  initialFlavorId,
  onClose,
  onAdded,
}: {
  menu: PublicMenu;
  initialFlavorId?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const catalog = useMemo(() => catalogFromMenu(menu), [menu]);
  const sizes = menu.menu.sizes.filter((s) => menu.menu.flavors.some((f) => f.prices[s.id] !== undefined));
  const initialFlavor = menu.menu.flavors.find((f) => f.id === initialFlavorId);
  const [sizeId, setSizeId] = useState<string>(
    () => sizes.find((s) => initialFlavor?.prices[s.id] !== undefined && s.max_flavors > 1)?.id ??
      sizes.find((s) => initialFlavor?.prices[s.id] !== undefined)?.id ?? sizes[0]?.id ?? '',
  );
  const size = sizes.find((s) => s.id === sizeId);
  const [flavorIds, setFlavorIds] = useState<string[]>(initialFlavorId ? [initialFlavorId] : []);
  const [crustId, setCrustId] = useState<string | null>(null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [search, setSearch] = useState('');

  const maxFlavors = size?.max_flavors ?? 1;
  const validFlavors = flavorIds.filter((id) => menu.menu.flavors.find((f) => f.id === id)?.prices[sizeId] !== undefined).slice(0, maxFlavors);
  const crusts = menu.menu.crusts.filter((c) => c.prices[sizeId] !== undefined);
  const addons = menu.menu.addons.filter((a) => a.applies_to !== 'product');
  const flavors = menu.menu.flavors.filter(
    (f) => f.prices[sizeId] !== undefined && f.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const cats = menu.menu.categories.filter((c) => c.kind === 'pizza');

  const input = {
    kind: 'pizza' as const,
    size_id: sizeId,
    flavor_ids: validFlavors,
    crust_id: crusts.some((c) => c.id === crustId) ? crustId : null,
    addon_ids: addonIds,
    quantity,
    notes,
  };
  const priced = validFlavors.length ? estimate(catalog, input) : null;

  const toggleFlavor = (id: string) => {
    setFlavorIds((cur) => {
      const valid = cur.filter((x) => validFlavors.includes(x));
      if (valid.includes(id)) return valid.filter((x) => x !== id);
      if (maxFlavors === 1) return [id];
      if (valid.length >= maxFlavors) return [...valid.slice(1), id];
      return [...valid, id];
    });
  };

  const add = () => {
    if (!priced) return;
    cart.add(menu.tenant.slug, {
      input,
      name: priced.name,
      description: priced.description,
      unit_price_cents: priced.unit_price_cents,
    });
    onAdded();
  };

  const fraction = validFlavors.length > 1 ? `1/${validFlavors.length}` : '';
  const ruleText =
    menu.ordering.half_half_pricing === 'highest' ? 'cobra-se pelo sabor de maior valor' : 'cobra-se a média dos sabores';

  return (
    <Sheet
      title="Monte sua pizza"
      onClose={onClose}
      footer={
        <div className="row">
          <Qty value={quantity} onChange={setQuantity} />
          <button className="btn primary grow lg" disabled={!priced} onClick={add}>
            {priced ? `Adicionar · ${brl(priced.total_cents)}` : 'Escolha um sabor'}
          </button>
        </div>
      }
    >
      <div className="pizza-visual" aria-hidden>
        {validFlavors.length > 1 && (
          <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }}>
            {validFlavors.map((_, i) => {
              const a = (i / validFlavors.length) * Math.PI * 2 - Math.PI / 2;
              return <line key={i} x1="50" y1="50" x2={50 + 50 * Math.cos(a)} y2={50 + 50 * Math.sin(a)} stroke="#b06a1e" strokeWidth="1.5" />;
            })}
          </svg>
        )}
        <div>{validFlavors.length ? `${validFlavors.length} sabor(es)` : 'Escolha os sabores'}</div>
      </div>

      <section className="stack">
        <div className="step-title">
          <h4>1. Tamanho</h4>
          <span className="badge">obrigatório</span>
        </div>
        <div className="size-grid">
          {sizes.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`option ${s.id === sizeId ? 'selected' : ''}`}
              onClick={() => setSizeId(s.id)}
            >
              <strong>{s.name}</strong>
              <span className="tiny muted">
                {s.slices} fatias · até {s.max_flavors} sabor{s.max_flavors > 1 ? 'es' : ''}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="step-title">
          <h4>2. Sabores</h4>
          <span className="badge brand">
            {validFlavors.length}/{maxFlavors}
          </span>
        </div>
        {maxFlavors > 1 && <p className="small muted">Pizza com até {maxFlavors} sabores: {ruleText}.</p>}
        {menu.menu.flavors.length > 6 && (
          <input className="input" placeholder="Buscar sabor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        )}
        {cats.map((cat) => {
          const list = flavors.filter((f) => f.category_id === cat.id);
          if (!list.length) return null;
          return (
            <div key={cat.id} className="stack tight">
              <p className="tiny bold muted" style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {cat.name}
              </p>
              <div className="choice-list">
                {list.map((f) => {
                  const selected = validFlavors.includes(f.id);
                  return (
                    <label key={f.id} className={`option ${selected ? 'selected' : ''} ${f.available ? '' : 'disabled'}`}>
                      <input
                        type={maxFlavors === 1 ? 'radio' : 'checkbox'}
                        checked={selected}
                        disabled={!f.available}
                        onChange={() => toggleFlavor(f.id)}
                      />
                      <div className="grow">
                        <div className="bold">
                          {selected && fraction ? `${fraction} ` : ''}
                          {f.name}
                        </div>
                        {f.description && <div className="tiny muted">{f.description}</div>}
                        {!f.available && <div className="tiny" style={{ color: 'var(--danger)' }}>Esgotado</div>}
                      </div>
                      <span className="bold small nowrap">{brl(f.prices[sizeId])}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {crusts.length > 0 && (
        <section className="stack">
          <div className="step-title">
            <h4>3. Borda</h4>
            <span className="badge">opcional</span>
          </div>
          <div className="choice-list">
            <label className={`option ${!input.crust_id ? 'selected' : ''}`}>
              <input type="radio" checked={!input.crust_id} onChange={() => setCrustId(null)} />
              <div className="grow bold">Sem borda recheada</div>
            </label>
            {crusts.map((c) => (
              <label key={c.id} className={`option ${input.crust_id === c.id ? 'selected' : ''} ${c.available ? '' : 'disabled'}`}>
                <input type="radio" checked={input.crust_id === c.id} disabled={!c.available} onChange={() => setCrustId(c.id)} />
                <div className="grow bold">{c.name}</div>
                <span className="small bold">+ {brl(c.prices[sizeId])}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {addons.length > 0 && (
        <section className="stack">
          <div className="step-title">
            <h4>{crusts.length ? '4' : '3'}. Adicionais</h4>
            <span className="badge">opcional</span>
          </div>
          <div className="choice-list">
            {addons.map((a) => (
              <label key={a.id} className={`option ${addonIds.includes(a.id) ? 'selected' : ''} ${a.available ? '' : 'disabled'}`}>
                <input
                  type="checkbox"
                  checked={addonIds.includes(a.id)}
                  disabled={!a.available}
                  onChange={(e) => setAddonIds((cur) => (e.target.checked ? [...cur, a.id] : cur.filter((x) => x !== a.id)))}
                />
                <div className="grow bold">{a.name}</div>
                <span className="small bold">+ {brl(a.price_cents)}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="stack tight">
        <h4>Alguma observação?</h4>
        <textarea
          className="input"
          maxLength={200}
          placeholder="Ex.: sem cebola, bem assada…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>
    </Sheet>
  );
}
