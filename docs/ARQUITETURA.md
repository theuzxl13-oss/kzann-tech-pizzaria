# Arquitetura

```
 Cliente (celular)                       Equipe (painel PWA)
   │  /p/<slug>                              │  /admin
   ▼                                         ▼
┌──────────────────────── Fastify (Node.js) ─────────────────────────┐
│ /api/public/*   cardápio, orçamento, pedido, acompanhamento (SSE)  │
│ /api/auth/*     cadastro, login, sessão, troca de senha            │
│ /api/admin/*    pedidos, cardápio, config., equipe, caixa, relat.  │
│ /api/webhooks/* Mercado Pago (assinatura HMAC + consulta à API)    │
│ estático        web/dist (SPA) + /uploads                          │
└───────────────┬───────────────────────────────┬────────────────────┘
                │ pool (papel kzann_app, RLS)   │ LISTEN kz_events
                ▼                               ▼
        ┌────────────────────── PostgreSQL ──────────────────────┐
        │ tabelas com tenant_id + políticas RLS + pg_notify       │
        └─────────────────────────────────────────────────────────┘
```

## Decisões principais

1. **Monólito modular.** Uma única aplicação Node serve a API e o frontend compilado. O deploy é simples (um container) e a aplicação escala horizontalmente: as sessões ficam no banco e o tempo real usa `LISTEN/NOTIFY`, não a memória do processo.
2. **Multi-tenant em banco compartilhado** com coluna `tenant_id` e **Row Level Security**. Cada requisição roda numa transação que executa `set_config('app.tenant_id', <id>, true)`. As políticas `tenant_id = app_tenant_id()` impedem ler ou gravar dados de outro estabelecimento, mesmo que uma consulta esqueça o filtro. `FORCE ROW LEVEL SECURITY` vale inclusive para o dono das tabelas.
3. **Domínio puro compartilhado.** Preço, cupons, horários, transições de status e permissões ficam em `server/src/domain` e `server/src/lib/permissions.ts`, sem I/O. O frontend importa o mesmo código para mostrar estimativas, mas **o servidor sempre recalcula** o pedido a partir do banco: preços enviados pelo cliente são ignorados.
4. **Tempo real.** O `pg_notify` é emitido dentro da transação do pedido e só é entregue no COMMIT. Cada instância mantém uma conexão `LISTEN` e repassa os eventos via SSE ao painel (filtrados por estabelecimento) e ao cliente (filtrados pelo token do pedido).
5. **Valores em centavos (inteiros)** em todo o sistema.

## Modelo de dados

| Tabela | Descrição |
|---|---|
| `tenants` | Pizzarias (slug do link, nome, status) |
| `tenant_settings` | Identidade visual, contato, regras de pedido, pagamentos, contador de pedidos |
| `users` | Pessoas (e-mail único, hash Argon2id). `created_by_tenant_id` para contas de funcionário |
| `memberships` | Vínculo usuário ↔ pizzaria com papel (`owner`, `manager`, `attendant`, `kitchen`, `courier`) |
| `sessions` | Sessões do painel (hash SHA-256 do token, expiração, pizzaria ativa) |
| `payment_gateways` | Credenciais Mercado Pago **criptografadas** (AES-256-GCM) |
| `opening_hours` | Turnos por dia da semana (aceita turno que passa da meia-noite) |
| `delivery_zones` | Regiões com taxa, bairros, pedido mínimo e tempo próprios |
| `categories` | Categorias de sabores (`pizza`) ou produtos (`product`) |
| `pizza_sizes` | Tamanhos, fatias e máximo de sabores |
| `pizza_flavors` + `flavor_prices` | Sabores e preço por tamanho |
| `crusts` + `crust_prices` | Bordas e preço por tamanho |
| `products` | Bebidas, sobremesas etc. |
| `addons` | Adicionais (para pizzas, produtos ou ambos) |
| `coupons` | Percentual, valor fixo ou frete grátis, com limites e validade |
| `customers` | Clientes por pizzaria (telefone, último endereço, nº de pedidos) |
| `orders` | Pedido com totais, pagamento, status e marcos de tempo |
| `order_items` | Itens com **snapshot** de nome, descrição e preço (o histórico não muda se o cardápio mudar) |
| `order_events` | Linha do tempo e auditoria do pedido (quem fez o quê) |
| `payments` | Cobranças online (id no gateway, status, QR Code, expiração) |
| `webhook_events` | Idempotência dos webhooks |
| `cash_sessions` + `cash_movements` | Caixa (abertura, sangria, suprimento, fechamento) |
| `audit_logs` | Auditoria de alterações administrativas |

O esquema completo está em [`server/src/migrations/001_init.sql`](../server/src/migrations/001_init.sql).

## Fluxo do pedido

```
           ┌──────────── Pix online ────────────┐
cliente ──►│ awaiting_payment ──(webhook ok)──► │──► pending ──► accepted ──► preparing ──► ready ──┬─► out_for_delivery ──► completed
           └────────────────────────────────────┘        (aceite automático opcional)              └─► completed (retirada)
                       qualquer etapa não final ──► cancelled (motivo obrigatório; cupom devolvido; estorno se pago online)
```

- A equipe pode avançar várias etapas de uma vez (por exemplo, de aceito direto para pronto), mas nunca voltar.
- Ao concluir um pedido pago na entrega ou retirada, o pagamento é registrado como recebido.
- Permissões por etapa: `orders.prepare` (aceitar, preparar, pronto), `orders.deliver` (saiu, concluído), `orders.cancel`.

## Permissões

| Permissão | Proprietário | Gerente | Atendente | Cozinha | Entregador |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver pedidos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Aceitar, preparar, pronto | ✓ | ✓ | ✓ | ✓ | |
| Saiu para entrega, concluir | ✓ | ✓ | ✓ | | ✓ |
| Cancelar pedido | ✓ | ✓ | ✓ | | |
| Confirmar pagamento manual | ✓ | ✓ | ✓ | | |
| Caixa / abrir e fechar loja | ✓ | ✓ | ✓ | | |
| Pausar item esgotado | ✓ | ✓ | ✓ | ✓ | |
| Editar cardápio e cupons | ✓ | ✓ | | | |
| Relatórios | ✓ | ✓ | | | |
| Configurações e entrega | ✓ | ✓ | | | |
| Equipe | ✓ | ✓ (exceto proprietários) | | | |

## Modo demonstração

O build `vite build --mode demo` troca a camada HTTP por `web/src/demo/server.ts`, que implementa as mesmas rotas no navegador (localStorage + BroadcastChannel para "tempo real" entre abas) e reutiliza o mesmo domínio do servidor. Esse modo existe **só** para o GitHub Pages. O sistema real é o backend com PostgreSQL.
