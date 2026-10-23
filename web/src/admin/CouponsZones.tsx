import { useState } from 'react';
import { Empty, Field, MoneyInput, Sheet, Switch, useLoad, useToast } from '../components/ui';
import { brl, del, get, patch, post } from '../lib/api';

const toLocalInput = (v: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function CouponsPage() {
  const { data, reload } = useLoad(() => get<any[]>('/api/admin/coupons'), []);
  const [editing, setEditing] = useState<any | null>(null);
  const toast = useToast();
  const describe = (c: any) =>
    c.type === 'percent' ? `${c.value}% de desconto` : c.type === 'fixed' ? `${brl(c.value)} de desconto` : 'Frete grátis';

  const save = async (c: any) => {
    const body = {
      code: c.code,
      type: c.type,
      value: c.type === 'free_delivery' ? 0 : c.value,
      min_order_cents: c.min_order_cents ?? 0,
      max_uses: c.max_uses || null,
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      active: c.active,
    };
    try {
      if (c.id) await patch(`/api/admin/coupons/${c.id}`, body);
      else await post('/api/admin/coupons', body);
      toast('Cupom salvo', 'ok');
      setEditing(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="row between">
        <p className="muted small">Crie códigos promocionais para divulgar no WhatsApp e redes sociais.</p>
        <button className="btn primary" onClick={() => setEditing({ code: '', type: 'percent', value: 10, min_order_cents: 0, max_uses: null, starts_at: null, ends_at: null, active: true })}>
          + Novo cupom
        </button>
      </div>
      <div className="table-wrap">
        {!data?.length ? (
          <Empty icon="🏷" title="Nenhum cupom criado" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Código</th><th>Benefício</th><th className="hide-mobile">Uso</th><th className="hide-mobile">Validade</th><th>Ativo</th><th /></tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="bold">{c.code}</td>
                  <td className="small">{describe(c)}{c.min_order_cents > 0 && <div className="tiny muted">mín. {brl(c.min_order_cents)}</div>}</td>
                  <td className="hide-mobile small">{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                  <td className="hide-mobile small muted">{c.ends_at ? `até ${new Date(c.ends_at).toLocaleDateString('pt-BR')}` : 'sem prazo'}</td>
                  <td><Switch checked={c.active} onChange={(v) => save({ ...c, active: v })} /></td>
                  <td className="right"><button className="btn sm ghost" onClick={() => setEditing(c)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <Sheet
          title={editing.id ? `Cupom ${editing.code}` : 'Novo cupom'}
          onClose={() => setEditing(null)}
          footer={
            <div className="row">
              {editing.id && (
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!confirm('Excluir cupom?')) return;
                    await del(`/api/admin/coupons/${editing.id}`).catch((e) => toast(e.message, 'error'));
                    setEditing(null);
                    reload();
                  }}
                >
                  Excluir
                </button>
              )}
              <button className="btn primary grow" onClick={() => save(editing)}>Salvar</button>
            </div>
          }
        >
          <Field label="Código" hint="Letras e números, ex.: PIZZA10">
            <input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} />
          </Field>
          <Field label="Tipo">
            <select className="input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value, value: e.target.value === 'percent' ? 10 : 0 })}>
              <option value="percent">Percentual (%)</option>
              <option value="fixed">Valor fixo (R$)</option>
              <option value="free_delivery">Frete grátis</option>
            </select>
          </Field>
          {editing.type === 'percent' && (
            <Field label="Desconto (%)">
              <input className="input" type="number" min={1} max={100} value={editing.value} onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })} />
            </Field>
          )}
          {editing.type === 'fixed' && (
            <Field label="Desconto (R$)">
              <MoneyInput value={editing.value} onChange={(v) => setEditing({ ...editing, value: v ?? 0 })} />
            </Field>
          )}
          <div className="grid2">
            <Field label="Pedido mínimo">
              <MoneyInput value={editing.min_order_cents} onChange={(v) => setEditing({ ...editing, min_order_cents: v ?? 0 })} />
            </Field>
            <Field label="Limite de usos" hint="Vazio = ilimitado">
              <input className="input" type="number" min={1} value={editing.max_uses ?? ''} onChange={(e) => setEditing({ ...editing, max_uses: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Início">
              <input className="input" type="datetime-local" value={toLocalInput(editing.starts_at)} onChange={(e) => setEditing({ ...editing, starts_at: fromLocalInput(e.target.value) })} />
            </Field>
            <Field label="Fim">
              <input className="input" type="datetime-local" value={toLocalInput(editing.ends_at)} onChange={(e) => setEditing({ ...editing, ends_at: fromLocalInput(e.target.value) })} />
            </Field>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function ZonesPage() {
  const { data, reload } = useLoad(() => get<any[]>('/api/admin/zones'), []);
  const [editing, setEditing] = useState<any | null>(null);
  const toast = useToast();
  const save = async (z: any) => {
    const body = {
      name: z.name,
      fee_cents: z.fee_cents ?? 0,
      neighborhoods: (typeof z.neighborhoods === 'string' ? z.neighborhoods.split(/[\n,;]/) : z.neighborhoods).map((s: string) => s.trim()).filter(Boolean),
      min_order_cents: z.min_order_cents,
      eta_minutes: z.eta_minutes || null,
      active: z.active,
      sort: z.sort ?? 0,
    };
    try {
      if (z.id) await patch(`/api/admin/zones/${z.id}`, body);
      else await post('/api/admin/zones', body);
      toast('Região salva', 'ok');
      setEditing(null);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <>
      <div className="row between">
        <p className="muted small">Defina taxas por região. O cliente escolhe o bairro e a taxa é aplicada automaticamente.</p>
        <button className="btn primary" onClick={() => setEditing({ name: '', fee_cents: 0, neighborhoods: '', min_order_cents: null, eta_minutes: null, active: true })}>
          + Nova região
        </button>
      </div>
      <div className="table-wrap">
        {!data?.length ? (
          <Empty icon="🛵" title="Nenhuma região de entrega">Sem regiões cadastradas, o cliente só consegue pedir para retirada.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Região</th><th>Taxa</th><th className="hide-mobile">Bairros</th><th>Ativa</th><th /></tr></thead>
            <tbody>
              {data.map((z) => (
                <tr key={z.id}>
                  <td className="bold">{z.name}{z.eta_minutes && <div className="tiny muted">{z.eta_minutes} min</div>}</td>
                  <td>{z.fee_cents ? brl(z.fee_cents) : 'Grátis'}</td>
                  <td className="hide-mobile small muted">{z.neighborhoods.join(', ') || '—'}</td>
                  <td><Switch checked={z.active} onChange={(v) => save({ ...z, active: v })} /></td>
                  <td className="right"><button className="btn sm ghost" onClick={() => setEditing({ ...z, neighborhoods: z.neighborhoods.join('\n') })}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <Sheet
          title={editing.id ? editing.name : 'Nova região'}
          onClose={() => setEditing(null)}
          footer={
            <div className="row">
              {editing.id && (
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (!confirm('Excluir região?')) return;
                    await del(`/api/admin/zones/${editing.id}`).catch((e) => toast(e.message, 'error'));
                    setEditing(null);
                    reload();
                  }}
                >
                  Excluir
                </button>
              )}
              <button className="btn primary grow" disabled={!editing.name.trim()} onClick={() => save(editing)}>Salvar</button>
            </div>
          }
        >
          <Field label="Nome da região">
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <div className="grid2">
            <Field label="Taxa de entrega">
              <MoneyInput value={editing.fee_cents} onChange={(v) => setEditing({ ...editing, fee_cents: v ?? 0 })} />
            </Field>
            <Field label="Tempo estimado (min)">
              <input className="input" type="number" min={0} value={editing.eta_minutes ?? ''} onChange={(e) => setEditing({ ...editing, eta_minutes: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
          <Field label="Pedido mínimo nesta região" hint="Vazio = usa o mínimo geral da loja">
            <MoneyInput allowEmpty value={editing.min_order_cents} onChange={(v) => setEditing({ ...editing, min_order_cents: v })} />
          </Field>
          <Field label="Bairros atendidos" hint="Um por linha. Vazio = o próprio nome da região aparece como opção.">
            <textarea className="input" rows={6} value={editing.neighborhoods} onChange={(e) => setEditing({ ...editing, neighborhoods: e.target.value })} />
          </Field>
        </Sheet>
      )}
    </>
  );
}
