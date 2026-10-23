import { useState } from 'react';
import { Field, Sheet, Switch, useLoad, useToast } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { ROLE_LABELS, ROLES, type Role } from '../lib/domain';
import { useSession } from './session';

const ROLE_HELP: Record<Role, string> = {
  owner: 'Acesso total, inclusive gestão de gerentes e proprietários.',
  manager: 'Acesso total, exceto alterar proprietários.',
  attendant: 'Pedidos, cancelamentos, confirmação de pagamento, caixa e disponibilidade do cardápio.',
  kitchen: 'Vê pedidos, aceita, prepara e marca como pronto. Pode pausar itens esgotados.',
  courier: 'Vê pedidos e marca saída para entrega e entregue.',
};

export function TeamPage() {
  const { data, reload } = useLoad(() => get<any[]>('/api/admin/team'), []);
  const { me } = useSession();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'attendant' as Role });
  const [tempPass, setTempPass] = useState<{ email: string; password: string } | null>(null);
  const toast = useToast();
  const assignable = ROLES.filter((r) => me?.role === 'owner' || r !== 'owner');

  const create = async () => {
    try {
      const r = await post('/api/admin/team', form);
      setTempPass({ email: form.email, password: r.temporary_password });
      setAdding(false);
      setForm({ name: '', email: '', role: 'attendant' });
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const update = async (id: string, body: unknown) => {
    try {
      await patch(`/api/admin/team/${id}`, body);
      toast('Atualizado', 'ok');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const reset = async (m: any) => {
    if (!confirm(`Gerar nova senha temporária para ${m.name}?`)) return;
    try {
      const r = await post(`/api/admin/team/${m.id}/reset-password`);
      setTempPass({ email: m.email, password: r.temporary_password });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="row between">
        <p className="muted small">Cada pessoa tem seu próprio login. As permissões dependem do papel.</p>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Adicionar pessoa</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {(data ?? []).map((m) => (
          <div key={m.id} className="list-item" style={m.active ? undefined : { opacity: 0.55 }}>
            <div className="grow">
              <div className="bold">{m.name} {m.id === me?.user.id && <span className="badge">você</span>}</div>
              <div className="small muted ellipsis">{m.email}{m.must_change_password && ' · aguardando primeiro acesso'}</div>
            </div>
            {m.id === me?.user.id ? (
              <span className="badge brand">{m.role_label}</span>
            ) : (
              <>
                <select className="input sm" style={{ width: 'auto' }} value={m.role} onChange={(e) => update(m.id, { role: e.target.value })} disabled={me?.role !== 'owner' && m.role === 'owner'}>
                  {ROLES.map((r) => <option key={r} value={r} disabled={!assignable.includes(r)}>{ROLE_LABELS[r]}</option>)}
                </select>
                <Switch checked={m.active} onChange={(v) => update(m.id, { active: v })} label="Ativo" />
                <button className="btn sm ghost hide-mobile" onClick={() => reset(m)}>Nova senha</button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="card stack tight">
        <h3 className="section-title" style={{ margin: 0 }}>Papéis</h3>
        {ROLES.map((r) => (
          <p key={r} className="small"><b>{ROLE_LABELS[r]}:</b> <span className="muted">{ROLE_HELP[r]}</span></p>
        ))}
      </div>

      {adding && (
        <Sheet title="Adicionar pessoa à equipe" onClose={() => setAdding(false)} footer={<button className="btn primary block" disabled={!form.name || !form.email} onClick={create}>Criar acesso</button>}>
          <Field label="Nome"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="E-mail (login)"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Papel">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>
          <p className="small muted">{ROLE_HELP[form.role]}</p>
        </Sheet>
      )}
      {tempPass && (
        <Sheet title="Senha temporária" onClose={() => setTempPass(null)} footer={<button className="btn primary block" onClick={() => setTempPass(null)}>Entendi</button>}>
          <div className="alert">Anote e repasse à pessoa. Por segurança, esta senha <b>não será mostrada novamente</b> e deverá ser trocada no primeiro acesso.</div>
          <p>Login: <b>{tempPass.email}</b></p>
          <div className="copy-code" style={{ fontSize: 18, textAlign: 'center' }}>{tempPass.password}</div>
        </Sheet>
      )}
    </>
  );
}
