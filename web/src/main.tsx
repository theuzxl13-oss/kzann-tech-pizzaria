import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout, RequirePerm } from './admin/AdminLayout';
import { ChangePasswordPage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage, TenantPicker } from './admin/AuthPages';
import { CashPage } from './admin/CashPage';
import { CouponsPage, ZonesPage } from './admin/CouponsZones';
import { HistoryPage, SharePage } from './admin/HistoryShare';
import { MenuAdmin } from './admin/MenuAdmin';
import { OrdersBoard } from './admin/OrdersBoard';
import { ReportsPage } from './admin/ReportsPage';
import { SessionProvider, useSession } from './admin/session';
import { SettingsPage } from './admin/SettingsPage';
import { TeamPage } from './admin/TeamPage';
import { PageLoading, ToastProvider } from './components/ui';
import { CheckoutPage } from './customer/CheckoutPage';
import { MenuPage } from './customer/MenuPage';
import { OrderPage } from './customer/OrderPage';
import { BASE, IS_DEMO } from './lib/api';
import './styles.css';

function AdminRoot() {
  const { me, loading } = useSession();
  if (loading) return <PageLoading />;
  if (!me) return <Navigate to="/admin/login" replace />;
  if (me.user.must_change_password) return <ChangePasswordPage forced />;
  if (!me.tenant) return <TenantPicker />;
  return <AdminLayout />;
}

function Landing() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <span className="logo">
          <img src={`${BASE}/icons/icon-192.png`} alt="" /> Kzann Tech
        </span>
        <div className="row">
          <Link to="/admin/login" className="btn ghost sm">Entrar</Link>
          <Link to="/admin/cadastro" className="btn primary sm hide-mobile">Criar conta</Link>
        </div>
      </nav>
      <section className="hero">
        <div>
          <span className="badge brand">Para pizzarias</span>
          <h1 style={{ marginTop: 14 }}>
            Seu cliente pede pelo link. <em>Sua equipe recebe na hora.</em>
          </h1>
          <p className="lead">
            Cardápio online com montagem de pizza meio a meio, entrega por bairro, cupons, Pix e painel em tempo real para a cozinha e o caixa — com a cara da sua pizzaria.
          </p>
          <div className="row wrap">
            {IS_DEMO ? (
              <>
                <Link to="/p/pizzaria-demo" className="btn primary lg">Ver cardápio de exemplo</Link>
                <Link to="/admin/login" className="btn dark lg">Abrir painel demo</Link>
              </>
            ) : (
              <>
                <Link to="/admin/cadastro" className="btn primary lg">Cadastrar minha pizzaria</Link>
                <Link to="/admin/login" className="btn ghost lg">Já tenho conta</Link>
              </>
            )}
          </div>
        </div>
        <div className="phone-mock hide-mobile" aria-hidden>
          <div className="screen">
            <div className="store-cover" style={{ height: 110 }} />
            <div style={{ padding: 14 }} className="stack tight">
              <div className="skeleton" style={{ height: 18, width: '60%' }} />
              {[1, 2, 3].map((i) => (
                <div key={i} className="item-card" style={{ margin: 0 }}>
                  <div className="grow stack tight">
                    <div className="skeleton" style={{ height: 14, width: '70%' }} />
                    <div className="skeleton" style={{ height: 10 }} />
                    <b style={{ color: 'var(--brand)' }}>R$ {44 + i * 6},90</b>
                  </div>
                  <div className="item-thumb" style={{ width: 60, height: 60, fontSize: 26 }}>🍕</div>
                </div>
              ))}
              <div className="btn primary block">Ver carrinho · R$ 109,80</div>
            </div>
          </div>
        </div>
      </section>
      <section className="features">
        {[
          ['🍕', 'Pizza do jeito do cliente', 'Tamanhos, até 4 sabores, bordas, adicionais e regra de preço configurável.'],
          ['⚡', 'Painel em tempo real', 'Alerta sonoro de novo pedido, fluxo aceito → preparo → pronto → entrega e impressão da comanda.'],
          ['💬', 'Feito para WhatsApp', 'Link do cardápio e mensagens prontas. O cliente acompanha o pedido sozinho.'],
          ['💳', 'Pagamentos', 'Dinheiro com troco, cartão na entrega, Pix pela chave e Pix online com confirmação por webhook.'],
          ['📊', 'Gestão', 'Relatórios de vendas, fechamento de caixa, cupons, taxas por bairro e equipe com permissões.'],
          ['🔒', 'Seguro e isolado', 'Cada pizzaria com seus dados isolados no banco (Row Level Security), senhas Argon2 e auditoria.'],
        ].map(([ic, t, d]) => (
          <div key={t} className="card feature">
            <div className="ic">{ic}</div>
            <h3>{t}</h3>
            <p className="small muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter basename={BASE || '/'}>
      <ToastProvider>
        <SessionProvider>
          {IS_DEMO && <div className="demo-ribbon">DEMONSTRAÇÃO</div>}
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/p/:slug" element={<MenuPage />} />
            <Route path="/p/:slug/checkout" element={<CheckoutPage />} />
            <Route path="/p/:slug/pedido/:token" element={<OrderPage />} />
            <Route path="/admin/login" element={<LoginPage />} />
            <Route path="/admin/cadastro" element={<SignupPage />} />
            <Route path="/admin/senha" element={<ChangePasswordPage />} />
            <Route path="/admin/esqueci-senha" element={<ForgotPasswordPage />} />
            <Route path="/admin/redefinir-senha" element={<ResetPasswordPage />} />
            <Route path="/admin/lojas" element={<TenantPicker />} />
            <Route path="/admin" element={<AdminRoot />}>
              <Route index element={<RequirePerm perm="orders.view"><OrdersBoard /></RequirePerm>} />
              <Route path="historico" element={<RequirePerm perm="orders.view"><HistoryPage /></RequirePerm>} />
              <Route path="cardapio" element={<RequirePerm perm="menu.availability"><MenuAdmin /></RequirePerm>} />
              <Route path="cupons" element={<RequirePerm perm="menu.manage"><CouponsPage /></RequirePerm>} />
              <Route path="entrega" element={<RequirePerm perm="settings.manage"><ZonesPage /></RequirePerm>} />
              <Route path="caixa" element={<RequirePerm perm="cash.manage"><CashPage /></RequirePerm>} />
              <Route path="relatorios" element={<RequirePerm perm="reports.view"><ReportsPage /></RequirePerm>} />
              <Route path="equipe" element={<RequirePerm perm="team.manage"><TeamPage /></RequirePerm>} />
              <Route path="divulgar" element={<RequirePerm perm="orders.view"><SharePage /></RequirePerm>} />
              <Route path="configuracoes" element={<RequirePerm perm="settings.manage"><SettingsPage /></RequirePerm>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

// GitHub Pages: o 404.html redireciona rotas profundas para index.html?p=/rota
const redirect = new URLSearchParams(location.search).get('p');
if (redirect) history.replaceState(null, '', `${BASE}${redirect}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch(() => {}));
}
