# Implantação

## Opção A: Docker Compose (VPS própria)

1. Copie o arquivo de exemplo e preencha `PUBLIC_BASE_URL`, `ENCRYPTION_KEY`, `SIGNUP_CODE`, `POSTGRES_OWNER_PASSWORD` e `KZANN_APP_PASSWORD`:
   ```bash
   cp .env.example .env
   ```
2. Suba os serviços:
   ```bash
   docker compose up -d --build
   ```
3. Coloque um proxy reverso com HTTPS na frente da porta 3000 (Caddy, Nginx ou Traefik). Exemplo com Caddy:
   ```
   pedidos.seudominio.com.br {
     reverse_proxy 127.0.0.1:3000 {
       flush_interval -1   # necessário para SSE (tempo real)
     }
   }
   ```
4. Acesse `https://pedidos.seudominio.com.br/admin/cadastro` e crie a primeira pizzaria (com o `SIGNUP_CODE`).

O script `deploy/init-app-role.sh` cria o papel `kzann_app` (sem superuser e sem BYPASSRLS) na primeira inicialização do banco. As migrações rodam automaticamente no start com o papel dono.

## Opção B: PaaS (Render, Railway, Fly.io) + PostgreSQL gerenciado (Neon, Supabase, RDS)

1. Crie o banco e **dois papéis**: um dono (migrações) e o da aplicação:
   ```sql
   CREATE ROLE kzann_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
   GRANT CONNECT, TEMP ON DATABASE kzann TO kzann_app;
   ```
   > No Supabase, **não** use o papel `postgres` nem o `service_role` como `DATABASE_URL`, porque eles ignoram o RLS.
2. Faça o deploy usando o `Dockerfile` ou com os comandos `npm ci && npm run build` (build) e `npm start` (start).
3. Configure as variáveis de ambiente (tabela abaixo) e o health check em `/api/health`.
4. **Uploads:** monte um volume persistente em `UPLOAD_DIR`. Em plataformas com disco efêmero, use um volume do provedor.
5. Para **várias instâncias**, nada muda: sessões, contadores e tempo real ficam no PostgreSQL. O balanceador precisa suportar conexões SSE longas (desative o buffering).

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|:-:|---|
| `NODE_ENV` | | `production` em produção |
| `PORT` / `HOST` | | Padrão `3000` / `0.0.0.0` |
| `PUBLIC_BASE_URL` | ✓ | URL pública (links, webhook, cookies `Secure`) |
| `DATABASE_URL` | ✓ | Conexão do papel **da aplicação** (sem BYPASSRLS) |
| `MIGRATION_DATABASE_URL` | | Conexão do papel dono, para as migrações |
| `DB_APP_ROLE` | | Papel que recebe os GRANTs após as migrações |
| `DB_SSL` | | `true` para exigir TLS no banco |
| `MIGRATE_ON_START` | | `false` para rodar as migrações separadamente (`npm run migrate`) |
| `ENCRYPTION_KEY` | ✓ | 32 bytes em base64 (AES-256-GCM das credenciais de gateway) |
| `SESSION_TTL_HOURS` | | Duração da sessão do painel (padrão 336 h) |
| `SIGNUP_MODE` | | `open`, `code` (padrão) ou `closed` |
| `SIGNUP_CODE` | se `code` | Código exigido no cadastro de pizzarias |
| `UPLOAD_DIR` | | Diretório persistente de imagens |
| `WEB_DIST_DIR` | | Caminho do frontend compilado |
| `TRUST_PROXY` | | `true` atrás de proxy/balanceador |
| `MERCADOPAGO_API_URL` | | Padrão `https://api.mercadopago.com` |
| `PIX_EXPIRATION_MINUTES` | | Validade do QR Code Pix (padrão 30) |

## Demonstração no GitHub Pages

O workflow `.github/workflows/pages.yml` gera o build `--mode demo` com `base=/<repositório>/` e publica no Pages a cada push na `main`. No GitHub, ative em **Settings → Pages → Source: GitHub Actions**.

A demonstração não usa backend. Para produção, use a opção A ou B.

## Checklist de produção
- [ ] HTTPS ativo e `PUBLIC_BASE_URL` com `https://`
- [ ] `DATABASE_URL` com papel **sem** BYPASSRLS (confira com `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`)
- [ ] `ENCRYPTION_KEY` gerada aleatoriamente e guardada num cofre de segredos
- [ ] `SIGNUP_MODE=code` ou `closed`
- [ ] Backups do banco e dos uploads
- [ ] Proxy sem buffering para `/api/admin/events` e `/api/public/*/events`
- [ ] Webhook do Mercado Pago cadastrado com a URL exibida no painel de cada pizzaria
