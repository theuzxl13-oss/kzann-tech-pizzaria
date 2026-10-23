# API

Respostas de erro: `{ "error": { "code": "...", "message": "...", "details"?: [...] } }`.
Rotas `/api/auth/*` e `/api/admin/*` que alteram estado exigem o cabeçalho `x-kzann-csrf: 1` e o cookie de sessão.

## Público (cardápio do cliente)
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/public/:slug` | Loja, status aberto/fechado, horários, regiões, formas de pagamento e cardápio |
| POST | `/api/public/:slug/quote` | Orçamento oficial `{items, fulfillment, delivery_zone_id?, neighborhood?, coupon_code?}` |
| POST | `/api/public/:slug/orders` | Cria pedido (`orderSchema` em `server/src/services/orders.ts`). Retorna `{id, number, token}` |
| GET | `/api/public/:slug/orders/:token` | Acompanhamento (inclui QR Code Pix quando aplicável) |
| GET | `/api/public/:slug/orders/:token/events` | SSE com mudanças de status |
| GET | `/api/public/:slug/manifest.webmanifest` | Manifesto PWA da pizzaria |

Item do carrinho:
```json
{ "kind": "pizza", "size_id": "uuid", "flavor_ids": ["uuid", "uuid"], "crust_id": "uuid|null", "addon_ids": [], "quantity": 1, "notes": "" }
{ "kind": "product", "product_id": "uuid", "addon_ids": [], "quantity": 2 }
```

## Autenticação
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/signup` | Cria pizzaria e proprietário `{pizzeria_name, slug, name, email, password, whatsapp_phone?, signup_code?}` |
| POST | `/api/auth/login` | `{email, password}` |
| POST | `/api/auth/logout` | Encerra a sessão |
| GET | `/api/auth/me` | Usuário, pizzaria ativa, papel e permissões |
| POST | `/api/auth/switch-tenant` | `{tenant_id}` |
| POST | `/api/auth/change-password` | `{current_password, new_password}` |

## Painel
| Método | Rota | Permissão |
|---|---|---|
| GET | `/api/admin/orders/board` | orders.view |
| GET | `/api/admin/orders?status=&from=&to=&q=&limit=&offset=` | orders.view |
| GET | `/api/admin/orders/:id` | orders.view |
| POST | `/api/admin/orders/:id/status` `{status, reason?}` | depende da etapa |
| POST | `/api/admin/orders/:id/confirm-payment` | payments.confirm |
| GET | `/api/admin/events` (SSE) | orders.view |
| GET | `/api/admin/customers?q=` | reports.view |
| GET/POST/PATCH/DELETE | `/api/admin/menu/{categories,sizes,flavors,crusts,products,addons}[/:id]` | menu.manage (PATCH só de `available`: menu.availability) |
| GET/POST/PATCH/DELETE | `/api/admin/coupons[/:id]` | menu.manage |
| GET/POST/PATCH/DELETE | `/api/admin/zones[/:id]` | settings.manage |
| GET/PUT | `/api/admin/settings` | settings.manage (GET: orders.view) |
| PUT | `/api/admin/hours` | settings.manage |
| POST | `/api/admin/store-status` `{manual_status}` | cash.manage |
| GET/PUT | `/api/admin/payment-gateway` | settings.manage |
| POST | `/api/admin/uploads` (multipart `file`) | menu.manage |
| GET/POST | `/api/admin/team` | team.manage |
| PATCH | `/api/admin/team/:id` `{role?, active?}` | team.manage |
| POST | `/api/admin/team/:id/reset-password` | team.manage |
| GET | `/api/admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD` | reports.view |
| GET | `/api/admin/cash/current` | cash.manage |
| POST | `/api/admin/cash/open` `{opening_cents}` | cash.manage |
| POST | `/api/admin/cash/movements` `{type, amount_cents, reason}` | cash.manage |
| POST | `/api/admin/cash/close` `{counted_cents, notes?}` | cash.manage |
| GET | `/api/admin/cash/sessions[/:id]` | cash.manage |

## Webhooks
| Método | Rota |
|---|---|
| POST | `/api/webhooks/mercadopago/:tenantId` |
