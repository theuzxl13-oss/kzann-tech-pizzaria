import { useMemo, useState } from 'react';
import { Qty, Sheet } from '../components/ui';
import { brl } from '../lib/api';
import { cart } from '../lib/cart';
import type { Product, PublicMenu } from '../lib/types';
import { catalogFromMenu, estimate } from './catalog';

export function ProductSheet({ menu, product, onClose, onAdded }: { menu: PublicMenu; product: Product; onClose: () => void; onAdded: () => void }) {
  const catalog = useMemo(() => catalogFromMenu(menu), [menu]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const addons = menu.menu.addons.filter((a) => a.applies_to !== 'pizza');
  const input = { kind: 'product' as const, product_id: product.id, addon_ids: addonIds, quantity, notes };
  const priced = estimate(catalog, input);

  return (
    <Sheet
      title={product.name}
      onClose={onClose}
      hero={product.image_url}
      footer={
        <div className="row">
          <Qty value={quantity} onChange={setQuantity} />
          <button
            className="btn primary grow lg"
            disabled={!priced}
            onClick={() => {
              if (!priced) return;
              cart.add(menu.tenant.slug, { input, name: priced.name, description: priced.description, unit_price_cents: priced.unit_price_cents });
              onAdded();
            }}
          >
            Adicionar · {brl(priced?.total_cents ?? product.price_cents * quantity)}
          </button>
        </div>
      }
    >
      {product.description && <p className="muted">{product.description}</p>}
      <p className="bold" style={{ fontSize: 20 }}>{brl(product.price_cents)}</p>
      {addons.length > 0 && (
        <section className="stack">
          <h4>Adicionais</h4>
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
        <h4>Observação</h4>
        <textarea className="input" maxLength={200} placeholder="Ex.: bem gelada" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>
    </Sheet>
  );
}
