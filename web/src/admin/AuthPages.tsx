import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field, useToast } from '../components/ui';
import { BASE, IS_DEMO, maskPhone, post } from '../lib/api';
import { useSession } from './session';

function Brand() {
  return (
    <Link to="/" className="logo" style={{ justifyContent: 'center', marginBottom: 18 }}>
      <img src={`${BASE}/icons/icon-192.png`} alt="" /> Kzann Tech
    </Link>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState(IS_DEMO ? 'dono@demo.kzann' : '');
  const [password, setPassword] = useState(IS_DEMO ? 'demo1234' : '');
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/auth/login', { email, password });
      await refresh();
      navigate('/admin', { replace: true });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <Brand />
        <h1 style={{ fontSize: 22 }}>Entrar no painel</h1>
        {IS_DEMO && (
          <div className="alert info small">
            Demonstração: use <b>dono@demo.kzann</b> / <b>demo1234</b> (proprietário) ou <b>cozinha@demo.kzann</b> / <b>demo1234</b> (cozinha).
          </div>
        )}
        <Field label="E-mail">
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="small center muted">
          Nova pizzaria? <Link to="/admin/cadastro">Cadastre-se</Link>
        </p>
      </form>
    </div>
  );
}

export function SignupPage() {
  const [f, setF] = useState({ pizzeria_name: '', slug: '', name: '', email: '', password: '', whatsapp_phone: '', signup_code: '' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const slugify = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    setF((cur) => ({ ...cur, [k]: v, ...(k === 'pizzeria_name' && !slugTouched ? { slug: slugify(v) } : {}) }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/auth/signup', { ...f, signup_code: f.signup_code || undefined });
      await refresh();
      toast('Pizzaria criada! Agora monte seu cardápio.', 'ok');
      navigate('/admin/cardapio', { replace: true });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <Brand />
        <h1 style={{ fontSize: 22 }}>Cadastre sua pizzaria</h1>
        <Field label="Nome da pizzaria">
          <input className="input" required minLength={2} value={f.pizzeria_name} onChange={set('pizzeria_name')} />
        </Field>
        <Field label="Endereço do cardápio" hint={`${location.host}${BASE}/p/${f.slug || 'sua-pizzaria'}`}>
          <input
            className="input"
            required
            pattern={'[a-z0-9][a-z0-9\\-]{1,48}[a-z0-9]'}
            value={f.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setF({ ...f, slug: slugify(e.target.value) });
            }}
          />
        </Field>
        <Field label="WhatsApp da pizzaria">
          <input className="input" type="tel" value={f.whatsapp_phone} onChange={(e) => setF({ ...f, whatsapp_phone: maskPhone(e.target.value) })} />
        </Field>
        <hr className="divider" />
        <Field label="Seu nome">
          <input className="input" required autoComplete="name" value={f.name} onChange={set('name')} />
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" required autoComplete="username" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Senha" hint="Mínimo 8 caracteres, com letras e números.">
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        <Field label="Código de cadastro (se fornecido pela Kzann Tech)">
          <input className="input" value={f.signup_code} onChange={set('signup_code')} />
        </Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Criando…' : 'Criar minha pizzaria'}</button>
        <p className="small center muted">
          Já tem conta? <Link to="/admin/login">Entrar</Link>
        </p>
      </form>
    </div>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/auth/change-password', { current_password: current, new_password: next });
      toast('Senha alterada', 'ok');
      await refresh();
      navigate('/admin', { replace: true });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <Brand />
        <h1 style={{ fontSize: 22 }}>{forced ? 'Crie sua senha' : 'Alterar senha'}</h1>
        {forced && <p className="muted small">Por segurança, troque a senha temporária recebida do seu gestor.</p>}
        <Field label={forced ? 'Senha temporária' : 'Senha atual'}>
          <input className="input" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="Nova senha" hint="Mínimo 8 caracteres, com letras e números.">
          <input className="input" type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <button className="btn primary lg" disabled={busy}>Salvar</button>
      </form>
    </div>
  );
}

export function TenantPicker() {
  const { me, refresh } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <div className="auth-page">
      <div className="card auth-card stack">
        <Brand />
        <h1 style={{ fontSize: 22 }}>Escolha a pizzaria</h1>
        {me.tenants.length === 0 && <p className="muted">Sua conta não está vinculada a nenhuma pizzaria ativa.</p>}
        {me.tenants.map((t) => (
          <button
            key={t.id}
            className="option"
            onClick={async () => {
              try {
                await post('/api/auth/switch-tenant', { tenant_id: t.id });
                await refresh();
                navigate('/admin');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            <span className="grow bold" style={{ textAlign: 'left' }}>{t.name}</span>
            <span className="badge">{t.role_label}</span>
          </button>
        ))}
        <button
          className="btn ghost"
          onClick={async () => {
            await post('/api/auth/logout');
            await refresh();
          }}
        >
          Sair
        </button>
      </div>
    </div>
  );
}
