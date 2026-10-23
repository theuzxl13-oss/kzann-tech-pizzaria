import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useToast } from '../components/ui';
import { BASE, get, post } from '../lib/api';
import type { Permission } from '../lib/domain';
import { useEventStream } from '../lib/sse';
import { useSession } from './session';

type Listener = (type: string, data: any) => void;
interface AdminCtx {
  subscribe: (l: Listener) => () => void;
  pendingCount: number;
  setPendingCount: (n: number) => void;
  soundOn: boolean;
  enableSound: () => void;
  ring: () => void;
}
const Ctx = createContext<AdminCtx>(null as unknown as AdminCtx);
export const useAdmin = () => useContext(Ctx);

const NAV: { to: string; label: string; ic: string; perm: Permission; mobile?: boolean }[] = [
  { to: '/admin', label: 'Pedidos', ic: '🧾', perm: 'orders.view', mobile: true },
  { to: '/admin/historico', label: 'Histórico', ic: '🕘', perm: 'orders.view', mobile: true },
  { to: '/admin/cardapio', label: 'Cardápio', ic: '🍕', perm: 'menu.availability', mobile: true },
  { to: '/admin/caixa', label: 'Caixa', ic: '💰', perm: 'cash.manage' },
  { to: '/admin/relatorios', label: 'Relatórios', ic: '📊', perm: 'reports.view' },
  { to: '/admin/cupons', label: 'Cupons', ic: '🏷', perm: 'menu.manage' },
  { to: '/admin/entrega', label: 'Entrega', ic: '🛵', perm: 'settings.manage' },
  { to: '/admin/equipe', label: 'Equipe', ic: '👥', perm: 'team.manage' },
  { to: '/admin/divulgar', label: 'Divulgar', ic: '📣', perm: 'orders.view' },
  { to: '/admin/configuracoes', label: 'Configurações', ic: '⚙️', perm: 'settings.manage' },
];

/** Bipe gerado via WebAudio (sem arquivo de áudio). */
function useChime() {
  const ctxRef = useRef<AudioContext | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const enableSound = useCallback(() => {
    ctxRef.current ??= new AudioContext();
    ctxRef.current.resume();
    setSoundOn(true);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }, []);
  const ring = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    [0, 0.18, 0.36].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = [880, 1175, 1568][i];
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.32);
    });
  }, []);
  return { soundOn, enableSound, ring };
}

export function AdminLayout() {
  const { me, can, refresh } = useSession();
  const toast = useToast();
  const listeners = useRef(new Set<Listener>());
  const [pendingCount, setPendingCount] = useState(0);
  const [storeOpen, setStoreOpen] = useState<null | { open: boolean; manual: string }>(null);
  const chime = useChime();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const pub = await get(`/api/public/${me!.tenant!.slug}`);
      setStoreOpen({ open: pub.status.open, manual: pub.status.manual_status });
    } catch {
      /* ignora */
    }
  }, [me]);
  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 60_000);
    return () => clearInterval(t);
  }, [loadStatus]);
  useEffect(() => setMoreOpen(false), [location.pathname]);

  useEventStream(can('orders.view') ? '/api/admin/events' : null, (type, data) => {
    if (type === 'order.created') {
      chime.ring();
      toast(`🔔 Novo pedido #${data?.number ?? ''}`, 'ok');
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        navigator.serviceWorker?.getRegistration().then((reg) => {
          const opts = { body: 'Toque para abrir o painel', icon: `${BASE}/icons/icon-192.png`, tag: `order-${data?.orderId}` };
          if (reg) reg.showNotification(`Novo pedido #${data?.number ?? ''}`, opts);
          else new Notification(`Novo pedido #${data?.number ?? ''}`, opts);
        });
      }
    }
    listeners.current.forEach((l) => l(type, data));
  });

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => listeners.current.delete(l);
  }, []);

  const toggleStore = async () => {
    if (!storeOpen || !can('cash.manage')) return;
    const next = storeOpen.open ? 'closed' : storeOpen.manual === 'closed' ? 'auto' : 'open';
    try {
      await post('/api/admin/store-status', { manual_status: next });
      await loadStatus();
      toast(next === 'closed' ? 'Loja fechada para pedidos' : 'Loja aberta para pedidos', 'ok');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const items = NAV.filter((n) => can(n.perm));
  const mobileItems = items.filter((n) => n.mobile);
  const title = [...items].sort((a, b) => b.to.length - a.to.length).find((n) => location.pathname.startsWith(n.to))?.label ?? 'Painel';

  return (
    <Ctx.Provider value={{ subscribe, pendingCount, setPendingCount, ...chime }}>
      <div className="admin">
        <aside className="admin-side">
          <Link to="/admin" className="logo">
            <img src={`${BASE}/icons/icon-192.png`} alt="" />
            <span className="ellipsis">{me?.tenant?.name}</span>
          </Link>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/admin'} className="nav-link">
              <span className="ic">{n.ic}</span>
              {n.label}
              {n.to === '/admin' && pendingCount > 0 && <span className="nav-badge">{pendingCount}</span>}
            </NavLink>
          ))}
          <div style={{ marginTop: 'auto' }} className="stack tight">
            <a className="nav-link" href={`${BASE}/p/${me?.tenant?.slug}`} target="_blank" rel="noreferrer">
              <span className="ic">↗</span> Ver cardápio
            </a>
            <UserBox onLogout={refresh} />
          </div>
        </aside>
        <div className="admin-main">
          <header className="admin-top">
            <h1>{title}</h1>
            {!chime.soundOn && can('orders.view') && (
              <button className="btn sm ghost" onClick={chime.enableSound} title="Ativar alertas sonoros de novos pedidos">
                🔔 <span className="hide-mobile">Ativar alertas</span>
              </button>
            )}
            {storeOpen && (
              <button className={`store-toggle ${storeOpen.open ? 'open' : ''}`} onClick={toggleStore} title="Abrir/fechar loja">
                <span className="led" />
                {storeOpen.open ? 'Aberta' : 'Fechada'}
              </button>
            )}
          </header>
          <main className="admin-content">
            <Outlet />
          </main>
        </div>
        <nav className="bottom-nav">
          {mobileItems.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/admin'}>
              <span className="ic">{n.ic}</span>
              {n.label}
              {n.to === '/admin' && pendingCount > 0 && <span className="dot">{pendingCount}</span>}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen((v) => !v)} className={moreOpen ? 'active' : ''}>
            <span className="ic">☰</span>Mais
          </button>
        </nav>
        {moreOpen && (
          <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
            <div className="sheet">
              <div className="sheet-body" style={{ paddingBottom: 90 }}>
                {items.filter((n) => !n.mobile).map((n) => (
                  <NavLink key={n.to} to={n.to} className="option">
                    <span>{n.ic}</span>
                    <span className="bold">{n.label}</span>
                  </NavLink>
                ))}
                <a className="option" href={`${BASE}/p/${me?.tenant?.slug}`} target="_blank" rel="noreferrer">
                  <span>↗</span>
                  <span className="bold">Ver cardápio</span>
                </a>
                <UserBox onLogout={refresh} light />
              </div>
            </div>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

function UserBox({ onLogout, light }: { onLogout: () => Promise<void>; light?: boolean }) {
  const { me } = useSession();
  return (
    <div className="stack tight" style={{ padding: '8px 10px', color: light ? 'var(--text)' : '#fff' }}>
      <div className="small bold ellipsis">{me?.user.name}</div>
      <div className="tiny ellipsis" style={{ opacity: 0.7 }}>{me?.user.email}</div>
      <div className="row wrap">
        {(me?.tenants.length ?? 0) > 1 && (
          <Link to="/admin/lojas" className="btn sm ghost" style={{ color: 'inherit' }}>Trocar loja</Link>
        )}
        <Link to="/admin/senha" className="btn sm ghost" style={{ color: 'inherit' }}>Senha</Link>
        <button
          className="btn sm ghost"
          style={{ color: 'inherit' }}
          onClick={async () => {
            await post('/api/auth/logout');
            await onLogout();
          }}
        >
          Sair
        </button>
      </div>
    </div>
  );
}

export function RequirePerm({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useSession();
  if (!can(perm)) return <div className="alert">Você não tem permissão para acessar esta área.</div>;
  return <>{children}</>;
}
