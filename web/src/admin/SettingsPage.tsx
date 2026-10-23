import { useEffect, useState } from 'react';
import { Field, MoneyInput, Switch, useLoad, useToast } from '../components/ui';
import { get, IS_DEMO, put, WEEKDAYS } from '../lib/api';
import { ImageField } from './MenuAdmin';
import { useSession } from './session';

type Hours = { weekday: number; opens: string; closes: string }[];

export function SettingsPage() {
  const { data, reload } = useLoad(() => get('/api/admin/settings'), []);
  const [f, setF] = useState<any>(null);
  const [hours, setHours] = useState<Hours>([]);
  const [tab, setTab] = useState<'loja' | 'horarios' | 'pedidos' | 'pagamentos'>('loja');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { refresh } = useSession();

  useEffect(() => {
    if (data) {
      setF(data);
      setHours(data.hours);
    }
  }, [data]);
  if (!f) return <div className="skeleton" style={{ height: 300 }} />;
  const set = (k: string, v: unknown) => setF((cur: any) => ({ ...cur, [k]: v }));

  const saveSettings = async () => {
    setBusy(true);
    try {
      const keys = [
        'name', 'description', 'whatsapp_phone', 'address', 'logo_url', 'cover_url', 'primary_color', 'secondary_color', 'timezone',
        'manual_status', 'min_order_cents', 'delivery_enabled', 'pickup_enabled', 'delivery_eta_minutes', 'pickup_eta_minutes',
        'half_half_pricing', 'accept_cash', 'accept_card_on_delivery', 'accept_pix_offline', 'accept_pix_online', 'pix_key',
        'pix_key_holder', 'auto_accept', 'whatsapp_template',
      ];
      await put('/api/admin/settings', Object.fromEntries(keys.map((k) => [k, f[k] ?? (k.endsWith('_url') ? null : f[k])])));
      toast('Configurações salvas', 'ok');
      await reload();
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveHours = async () => {
    setBusy(true);
    try {
      await put('/api/admin/hours', hours);
      toast('Horários salvos', 'ok');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tabs">
        {(['loja', 'horarios', 'pedidos', 'pagamentos'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ loja: 'Loja e identidade visual', horarios: 'Horários', pedidos: 'Pedidos e entrega', pagamentos: 'Pagamentos' }[t]}
          </button>
        ))}
      </div>

      {tab === 'loja' && (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="card stack">
            <Field label="Nome da pizzaria"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Descrição curta"><textarea className="input" maxLength={500} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Field label="WhatsApp (com DDD)"><input className="input" type="tel" value={f.whatsapp_phone} onChange={(e) => set('whatsapp_phone', e.target.value)} /></Field>
            <Field label="Endereço"><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Link do cardápio" hint="Endereço fixo; não pode ser alterado.">
              <input className="input" readOnly value={f.menu_url} />
            </Field>
          </div>
          <div className="card stack">
            <h3 className="section-title" style={{ margin: 0 }}>Identidade visual</h3>
            <ImageField label="Logo" value={f.logo_url ?? ''} onChange={(v) => set('logo_url', v || null)} />
            <ImageField label="Imagem de capa" value={f.cover_url ?? ''} onChange={(v) => set('cover_url', v || null)} />
            <div className="grid2">
              <Field label="Cor principal">
                <div className="row">
                  <input type="color" className="color-input" value={f.primary_color} onChange={(e) => set('primary_color', e.target.value.toUpperCase())} />
                  <input className="input" value={f.primary_color} onChange={(e) => set('primary_color', e.target.value)} />
                </div>
              </Field>
              <Field label="Cor secundária">
                <div className="row">
                  <input type="color" className="color-input" value={f.secondary_color} onChange={(e) => set('secondary_color', e.target.value.toUpperCase())} />
                  <input className="input" value={f.secondary_color} onChange={(e) => set('secondary_color', e.target.value)} />
                </div>
              </Field>
            </div>
            <div className="card flat" style={{ background: f.primary_color, color: '#fff', textAlign: 'center' }}>
              <strong>Prévia do botão</strong>
            </div>
          </div>
        </div>
      )}

      {tab === 'horarios' && (
        <div className="card stack">
          <p className="small muted">Para expedientes que passam da meia-noite, informe o fechamento menor que a abertura (ex.: 18:00 → 02:00).</p>
          {WEEKDAYS.map((day, wd) => {
            const list = hours.map((h, i) => ({ ...h, i })).filter((h) => h.weekday === wd);
            return (
              <div key={wd} className="row wrap" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                <strong style={{ width: 90 }}>{day}</strong>
                {list.length === 0 && <span className="muted small grow">Fechado</span>}
                <div className="stack tight grow">
                  {list.map((h) => (
                    <div key={h.i} className="row">
                      <input className="input sm" type="time" value={h.opens} onChange={(e) => setHours(hours.map((x, j) => (j === h.i ? { ...x, opens: e.target.value } : x)))} />
                      <span>às</span>
                      <input className="input sm" type="time" value={h.closes} onChange={(e) => setHours(hours.map((x, j) => (j === h.i ? { ...x, closes: e.target.value } : x)))} />
                      <button className="icon-btn" onClick={() => setHours(hours.filter((_, j) => j !== h.i))} aria-label="Remover">✕</button>
                    </div>
                  ))}
                </div>
                <button className="btn sm ghost" onClick={() => setHours([...hours, { weekday: wd, opens: '18:00', closes: '23:30' }])}>+ Turno</button>
              </div>
            );
          })}
          <Field label="Fuso horário">
            <select className="input" value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((tz) => (
                <option key={tz} value={tz}>{tz.replace('America/', '').replace('_', ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Status da loja">
            <select className="input" value={f.manual_status} onChange={(e) => set('manual_status', e.target.value)}>
              <option value="auto">Automático (pelo horário)</option>
              <option value="open">Forçar ABERTO</option>
              <option value="closed">Forçar FECHADO</option>
            </select>
          </Field>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={saveHours}>Salvar horários</button>
            <button className="btn ghost" disabled={busy} onClick={saveSettings}>Salvar status/fuso</button>
          </div>
        </div>
      )}

      {tab === 'pedidos' && (
        <div className="card stack">
          <Toggle label="Entrega (delivery)" checked={f.delivery_enabled} onChange={(v) => set('delivery_enabled', v)} />
          <Toggle label="Retirada no balcão" checked={f.pickup_enabled} onChange={(v) => set('pickup_enabled', v)} />
          <div className="grid3">
            <Field label="Pedido mínimo"><MoneyInput value={f.min_order_cents} onChange={(v) => set('min_order_cents', v ?? 0)} /></Field>
            <Field label="Tempo médio entrega (min)"><input className="input" type="number" min={0} value={f.delivery_eta_minutes} onChange={(e) => set('delivery_eta_minutes', Number(e.target.value))} /></Field>
            <Field label="Tempo médio retirada (min)"><input className="input" type="number" min={0} value={f.pickup_eta_minutes} onChange={(e) => set('pickup_eta_minutes', Number(e.target.value))} /></Field>
          </div>
          <Field label="Preço da pizza com mais de um sabor">
            <select className="input" value={f.half_half_pricing} onChange={(e) => set('half_half_pricing', e.target.value)}>
              <option value="highest">Cobrar pelo sabor mais caro</option>
              <option value="average">Cobrar a média dos sabores</option>
            </select>
          </Field>
          <Toggle label="Aceitar pedidos automaticamente" hint="Pedidos novos já entram como “Aceito”." checked={f.auto_accept} onChange={(v) => set('auto_accept', v)} />
          <Field label="Mensagem de divulgação no WhatsApp" hint="Use {pizzaria} e {link} — substituídos automaticamente.">
            <textarea className="input" maxLength={500} value={f.whatsapp_template} onChange={(e) => set('whatsapp_template', e.target.value)} />
          </Field>
          <button className="btn primary" disabled={busy} onClick={saveSettings}>Salvar</button>
        </div>
      )}

      {tab === 'pagamentos' && (
        <div className="stack">
          <div className="card stack">
            <h3 className="section-title" style={{ margin: 0 }}>Pagamento na entrega / retirada</h3>
            <Toggle label="Dinheiro" checked={f.accept_cash} onChange={(v) => set('accept_cash', v)} />
            <Toggle label="Cartão (maquininha)" checked={f.accept_card_on_delivery} onChange={(v) => set('accept_card_on_delivery', v)} />
            <Toggle label="Pix pela chave da pizzaria" hint="O cliente transfere e a equipe confirma o recebimento manualmente." checked={f.accept_pix_offline} onChange={(v) => set('accept_pix_offline', v)} />
            {f.accept_pix_offline && (
              <div className="grid2">
                <Field label="Chave Pix"><input className="input" value={f.pix_key} onChange={(e) => set('pix_key', e.target.value)} /></Field>
                <Field label="Titular"><input className="input" value={f.pix_key_holder} onChange={(e) => set('pix_key_holder', e.target.value)} /></Field>
              </div>
            )}
            <Toggle label="Pix online (Mercado Pago)" hint="QR Code automático com confirmação via webhook. Requer credenciais abaixo." checked={f.accept_pix_online} onChange={(v) => set('accept_pix_online', v)} />
            <button className="btn primary" disabled={busy} onClick={saveSettings}>Salvar</button>
          </div>
          <GatewayCard />
        </div>
      )}
    </>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row between" style={{ padding: '4px 0' }}>
      <div>
        <div className="bold">{label}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function GatewayCard() {
  const { data, reload } = useLoad(() => get('/api/admin/payment-gateway'), []);
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setEnabled(data.enabled);
  }, [data]);
  if (!data) return null;
  const save = async () => {
    try {
      await put('/api/admin/payment-gateway', { enabled, access_token: token || undefined, webhook_secret: secret || undefined });
      setToken('');
      setSecret('');
      toast('Credenciais salvas com criptografia', 'ok');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="card stack">
      <h3 className="section-title" style={{ margin: 0 }}>Gateway Mercado Pago</h3>
      {IS_DEMO && <div className="alert">Na demonstração não há integração real com o Mercado Pago.</div>}
      <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>No painel de desenvolvedor do Mercado Pago, crie uma aplicação e copie o <b>Access Token</b> de produção.</li>
        <li>Em Webhooks, cadastre a URL abaixo com o evento <b>Pagamentos</b> e copie a <b>assinatura secreta</b>.</li>
        <li>Cole as duas credenciais aqui. Elas são guardadas criptografadas e nunca são exibidas novamente.</li>
      </ol>
      <Field label="URL do webhook">
        <input className="input" readOnly value={data.webhook_url} onFocus={(e) => e.target.select()} />
      </Field>
      <div className="grid2">
        <Field label={`Access Token ${data.has_access_token ? '(configurado ✓)' : ''}`}>
          <input className="input" type="password" autoComplete="off" placeholder={data.has_access_token ? '•••••••• (manter)' : 'APP_USR-…'} value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        <Field label={`Assinatura secreta do webhook ${data.has_webhook_secret ? '(configurada ✓)' : ''}`}>
          <input className="input" type="password" autoComplete="off" placeholder={data.has_webhook_secret ? '•••••••• (manter)' : ''} value={secret} onChange={(e) => setSecret(e.target.value)} />
        </Field>
      </div>
      <div className="row between">
        <label className="check"><Switch checked={enabled} onChange={setEnabled} /> Integração ativa</label>
        <button className="btn primary" onClick={save}>Salvar gateway</button>
      </div>
    </div>
  );
}
