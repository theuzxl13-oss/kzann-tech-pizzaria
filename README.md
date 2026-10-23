# Kzann Tech: pedidos online para pizzarias

Plataforma SaaS **multi-tenant** de pedidos online para pizzarias. O cliente recebe o link pelo WhatsApp, monta a pizza (até 4 sabores, borda e adicionais), escolhe entrega ou retirada, paga e acompanha o pedido em tempo real. A equipe da pizzaria recebe o pedido na hora no painel, aceita, prepara, marca como pronto e conclui a entrega.

> **Demonstração (GitHub Pages):** versão estática que roda **no navegador, sem servidor**, com uma pizzaria de exemplo. Ela serve para navegar e entender a lógica. Os dados ficam só no seu navegador e **não há pagamento online**. Login da demo: `dono@demo.kzann` / `demo1234` (proprietário) ou `cozinha@demo.kzann` / `demo1234` (cozinha).

## Funcionalidades

**Cliente (PWA, celular primeiro)**
- Cardápio público por link `/p/<pizzaria>`, com a identidade visual da pizzaria (cores, logo, capa) e instalável na tela inicial.
- Montagem de pizza: tamanho, 1 a 4 sabores (meio a meio), borda, adicionais, observações e quantidade.
- Carrinho, entrega por bairro/região (taxa automática) ou retirada, cupom de desconto e pedido mínimo.
- Pagamento em dinheiro (com troco), cartão na entrega, Pix pela chave da pizzaria (confirmação manual) e **Pix online via Mercado Pago**, confirmado só por webhook assinado.
- Acompanhamento do pedido em tempo real, botão para falar com a pizzaria no WhatsApp e comprovante imprimível.

**Painel da pizzaria**
- Quadro de pedidos em tempo real (SSE), com alerta sonoro, notificação do sistema e contador de pendentes.
- Fluxo `Novo → Aceito → Em preparo → Pronto → Saiu para entrega → Concluído`, com cancelamento obrigando informar o motivo.
- Impressão de comanda para impressora térmica de 80 mm. Mensagens de status prontas para enviar ao cliente pelo WhatsApp.
- Cardápio: sabores com preço por tamanho, tamanhos (limite de sabores), bordas, produtos, adicionais, categorias, fotos e pausa de itens esgotados.
- Regra de preço do meio a meio (sabor mais caro ou média), cupons (%, valor fixo, frete grátis, limites e validade), regiões de entrega, horários (inclusive expediente que passa da meia-noite), abrir e fechar a loja manualmente e aceite automático.
- Equipe com papéis: proprietário, gerente, atendente, cozinha e entregador. Senha temporária com troca obrigatória.
- Histórico com filtros, relatórios de vendas (KPIs, por dia, horário, pagamento, sabores e produtos mais vendidos, cupons, cancelamentos, exportação CSV).
- Caixa: abertura com fundo de troco, sangria e suprimento, fechamento com conferência (esperado × contado) e relatório imprimível.
- Divulgação: link do cardápio e mensagem pronta para o WhatsApp.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20+, TypeScript, Fastify 5, Zod |
| Banco | PostgreSQL 14+ com **Row Level Security** por estabelecimento |
| Tempo real | PostgreSQL `LISTEN/NOTIFY` + Server-Sent Events |
| Auth | Sessões opacas em cookie httpOnly, senhas Argon2id |
| Frontend | React 19, React Router, Vite, PWA (manifest + service worker) |
| Pagamentos | Mercado Pago (Pix), webhook com HMAC e consulta à API |
| Testes | `node:test` contra PostgreSQL real (embedded-postgres) |

## Rodando localmente

Requisitos: Node.js 20.11 ou superior. Não é preciso instalar o PostgreSQL: o script de desenvolvimento usa os binários oficiais via `embedded-postgres`.

```bash
npm install
```

```bash
cp .env.example .env
```

Para desenvolvimento, use no `.env`:

```
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:5173
DATABASE_URL=postgres://kzann_app:kzann_app_dev@localhost:54329/kzann
MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:54329/kzann
DB_APP_ROLE=kzann_app
ENCRYPTION_KEY=<gere com o comando do .env.example>
SIGNUP_MODE=open
UPLOAD_DIR=./uploads
```

Em três terminais:

```bash
npm run db:dev
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Depois acesse `http://localhost:5173`, clique em **Criar conta**, monte o cardápio e abra o link `/p/<sua-pizzaria>` no celular ou em outra aba.

### Testes

```bash
npm test
```

Os testes sobem um PostgreSQL real e descartável e cobrem: cadastro e login, CSRF, montagem do cardápio, preço do meio a meio, cupons, pedido mínimo, troco, bairro, **isolamento entre pizzarias (API e RLS direto no banco)**, permissões por papel, ciclo do pedido, caixa, relatórios, Pix online com webhook assinado (gateway falso apenas no teste) e tempo real via SSE.

### Demonstração local

```bash
npm run dev:demo -w web
```

## Documentação

- [Arquitetura e banco de dados](docs/ARQUITETURA.md)
- [Segurança](docs/SEGURANCA.md)
- [Implantação e variáveis de ambiente](docs/IMPLANTACAO.md)
- [Referência da API](docs/API.md)
- [Integração Mercado Pago (Pix)](docs/PAGAMENTOS.md)

## Estrutura

```
server/            API (Fastify + PostgreSQL)
  src/domain/      regras puras: preço, cupons, horários, fluxo do pedido (compartilhadas com o web)
  src/services/    pedidos, catálogo, estabelecimento
  src/routes/      auth, público, admin, webhooks
  src/payments/    cliente Mercado Pago + verificação de assinatura
  src/migrations/  SQL (tabelas + políticas RLS)
  test/            testes de integração
web/               PWA React (cliente + painel)
  src/customer/    cardápio, montagem, checkout, acompanhamento
  src/admin/       painel da pizzaria
  src/demo/        "backend" no navegador usado SÓ no build de demonstração
docs/              documentação
```
