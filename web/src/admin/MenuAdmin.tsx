import { useState } from 'react';
import { Empty, Field, MoneyInput, Sheet, Switch, useLoad, useToast } from '../components/ui';
import { api, brl, del, get, patch, post } from '../lib/api';
import { useSession } from './session';

type Tab = 'flavors' | 'sizes' | 'crusts' | 'products' | 'addons' | 'categories';
const TABS: { key: Tab; label: string }[] = [
  { key: 'flavors', label: 'Sabores de pizza' },
  { key: 'sizes', label: 'Tamanhos' },
  { key: 'crusts', label: 'Bordas' },
  { key: 'products', label: 'Bebidas e outros' },
  { key: 'addons', label: 'Adicionais' },
  { key: 'categories', label: 'Categorias' },
];

export function MenuAdmin() {
  const [tab, setTab] = useState<Tab>('flavors');
  const data = useLoad(async () => {
    const [categories, sizes, flavors, crusts, products, addons] = await Promise.all(
      ['categories', 'sizes', 'flavors', 'crusts', 'products', 'addons'].map((k) => get<any[]>(`/api/admin/menu/${k}`)),
    );
    return { categories, sizes, flavors, crusts, products, addons };
  }, []);
  const [editing, setEditing] = useState<any | null>(null);
  const { can } = useSession();
  const manage = can('menu.manage');
  const toast = useToast();

  if (!data.data) return <div className="skeleton" style={{ height: 300 }} />;
  const d = data.data;
  const list: any[] = d[tab];

  const toggleAvailable = async (item: any) => {
    try {
      await patch(`/api/admin/menu/${tab}/${item.id}`, { available: !item.available });
      toast(item.available ? `${item.name} pausado (esgotado)` : `${item.name} disponível`, 'ok');
      data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const hasAvailability = ['flavors', 'crusts', 'products', 'addons'].includes(tab);
  const sizeName = (id: string) => d.sizes.find((s: any) => s.id === id)?.name;

  return (
    <>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label} <span className="muted">({d[t.key].length})</span>
          </button>
        ))}
      </div>

      {tab === 'flavors' && d.sizes.length > 0 && d.flavors.length === 0 && (
        <div className="alert info">Cadastre os sabores e defina o preço de cada tamanho. Sabores sem preço em um tamanho não aparecem para esse tamanho.</div>
      )}

      <div className="row between">
        <p className="small muted">
          {hasAvailability && 'Use o interruptor para pausar itens esgotados — o cliente verá "Esgotado".'}
        </p>
        {manage && (
          <button className="btn primary" onClick={() => setEditing({ __new: true })}>
            + Novo
          </button>
        )}
      </div>

      <div className="table-wrap">
        {list.length === 0 ? (
          <Empty title="Nada cadastrado ainda" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th className="hide-mobile">Detalhes</th>
                {hasAvailability && <th>Disponível</th>}
                {manage && <th />}
              </tr>
            </thead>
            <tbody>
              {list.map((item) => (
                <tr key={item.id} style={item.active === false ? { opacity: 0.5 } : undefined}>
                  <td>
                    <div className="bold">{item.name}</div>
                    {item.active === false && <span className="badge">Oculto</span>}
                    <div className="tiny muted only-mobile">{describe(tab, item, d, sizeName)}</div>
                  </td>
                  <td className="hide-mobile small muted">{describe(tab, item, d, sizeName)}</td>
                  {hasAvailability && (
                    <td>
                      <Switch checked={item.available} onChange={() => toggleAvailable(item)} label="Disponível" />
                    </td>
                  )}
                  {manage && (
                    <td className="right">
                      <button className="btn sm ghost" onClick={() => setEditing(item)}>Editar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EditSheet
          tab={tab}
          item={editing}
          data={d}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}

function describe(tab: Tab, item: any, d: any, sizeName: (id: string) => string | undefined) {
  switch (tab) {
    case 'flavors':
    case 'crusts': {
      const prices = Object.entries(item.prices ?? {}) as [string, number][];
      const cat = tab === 'flavors' ? d.categories.find((c: any) => c.id === item.category_id)?.name : '';
      return [cat, prices.map(([s, p]) => `${sizeName(s)} ${brl(p)}`).join(' · ') || 'sem preços'].filter(Boolean).join(' — ');
    }
    case 'sizes':
      return `${item.slices} fatias · até ${item.max_flavors} sabores`;
    case 'products':
      return `${d.categories.find((c: any) => c.id === item.category_id)?.name ?? ''} — ${brl(item.price_cents)}`;
    case 'addons':
      return `${brl(item.price_cents)} · ${{ pizza: 'pizzas', product: 'produtos', all: 'todos' }[item.applies_to as string]}`;
    case 'categories':
      return item.kind === 'pizza' ? 'Sabores de pizza' : 'Produtos';
  }
}

function EditSheet({ tab, item, data, onClose, onSaved }: { tab: Tab; item: any; data: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !!item.__new;
  const defaults: Record<Tab, any> = {
    flavors: { name: '', description: '', category_id: data.categories.find((c: any) => c.kind === 'pizza')?.id ?? '', image_url: '', prices: {}, active: true, sort: 0 },
    sizes: { name: '', slices: 8, max_flavors: 2, active: true, sort: 0 },
    crusts: { name: '', prices: {}, active: true, sort: 0 },
    products: { name: '', description: '', category_id: data.categories.find((c: any) => c.kind === 'product')?.id ?? '', price_cents: 0, image_url: '', active: true, sort: 0 },
    addons: { name: '', price_cents: 0, applies_to: 'pizza', active: true, sort: 0 },
    categories: { name: '', kind: 'pizza', active: true, sort: 0 },
  };
  const [f, setF] = useState<any>(isNew ? defaults[tab] : { ...item, image_url: item.image_url ?? '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: string, v: unknown) => setF((cur: any) => ({ ...cur, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const { id, tenant_id, __new, available, ...body } = f;
      void tenant_id; void __new; void available;
      if (tab === 'flavors' || tab === 'crusts') {
        // envia null para remover preços apagados
        const prices: Record<string, number | null> = {};
        for (const s of data.sizes) prices[s.id] = f.prices[s.id] ?? null;
        body.prices = prices;
      }
      if ('image_url' in body && !body.image_url) body.image_url = null;
      if (isNew) await post(`/api/admin/menu/${tab}`, body);
      else await patch(`/api/admin/menu/${tab}/${id}`, body);
      toast('Salvo', 'ok');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Excluir "${f.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await del(`/api/admin/menu/${tab}/${f.id}`);
      toast('Excluído', 'ok');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const catsOf = (kind: string) => data.categories.filter((c: any) => c.kind === kind);

  return (
    <Sheet
      title={isNew ? 'Novo item' : `Editar ${f.name}`}
      onClose={onClose}
      footer={
        <div className="row">
          {!isNew && <button className="btn danger" onClick={remove}>Excluir</button>}
          <button className="btn primary grow" disabled={busy || !f.name?.trim()} onClick={save}>
            Salvar
          </button>
        </div>
      }
    >
      <Field label="Nome">
        <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </Field>

      {(tab === 'flavors' || tab === 'products') && (
        <>
          <Field label="Categoria">
            <select className="input" value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
              {catsOf(tab === 'flavors' ? 'pizza' : 'product').map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Descrição / ingredientes">
            <textarea className="input" maxLength={400} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <ImageField value={f.image_url} onChange={(v) => set('image_url', v)} />
        </>
      )}

      {(tab === 'flavors' || tab === 'crusts') && (
        <section className="stack tight">
          <h4>Preço por tamanho</h4>
          <p className="tiny muted">Deixe em branco os tamanhos em que este item não é vendido.</p>
          <div className="price-grid">
            {data.sizes.map((s: any) => (
              <Field key={s.id} label={s.name}>
                <MoneyInput
                  allowEmpty
                  value={f.prices[s.id] ?? null}
                  onChange={(v) => set('prices', { ...f.prices, [s.id]: v ?? undefined })}
                  placeholder="—"
                />
              </Field>
            ))}
          </div>
        </section>
      )}

      {tab === 'sizes' && (
        <div className="grid2">
          <Field label="Fatias">
            <input className="input" type="number" min={1} max={32} value={f.slices} onChange={(e) => set('slices', Number(e.target.value))} />
          </Field>
          <Field label="Máximo de sabores (meio a meio)">
            <select className="input" value={f.max_flavors} onChange={(e) => set('max_flavors', Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
      )}

      {(tab === 'products' || tab === 'addons') && (
        <Field label="Preço">
          <MoneyInput value={f.price_cents} onChange={(v) => set('price_cents', v ?? 0)} />
        </Field>
      )}

      {tab === 'addons' && (
        <Field label="Disponível para">
          <select className="input" value={f.applies_to} onChange={(e) => set('applies_to', e.target.value)}>
            <option value="pizza">Pizzas</option>
            <option value="product">Produtos</option>
            <option value="all">Todos</option>
          </select>
        </Field>
      )}

      {tab === 'categories' && (
        <Field label="Tipo">
          <select className="input" value={f.kind} disabled={!isNew} onChange={(e) => set('kind', e.target.value)}>
            <option value="pizza">Sabores de pizza</option>
            <option value="product">Produtos (bebidas, sobremesas…)</option>
          </select>
        </Field>
      )}

      <div className="grid2">
        <Field label="Ordem de exibição">
          <input className="input" type="number" min={0} value={f.sort} onChange={(e) => set('sort', Number(e.target.value))} />
        </Field>
        <label className="check" style={{ alignSelf: 'end' }}>
          <Switch checked={f.active} onChange={(v) => set('active', v)} /> Visível no cardápio
        </label>
      </div>
    </Sheet>
  );
}

export function ImageField({ value, onChange, label = 'Foto' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ url: string }>('POST', '/api/admin/uploads', fd);
      onChange(r.url);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={label} hint="PNG, JPG ou WEBP até 3 MB.">
      <div className="row">
        {value && <img src={value} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} />}
        <label className="btn sm ghost">
          {busy ? 'Enviando…' : value ? 'Trocar' : 'Enviar imagem'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {value && <button type="button" className="btn sm link" onClick={() => onChange('')}>Remover</button>}
      </div>
    </Field>
  );
}
