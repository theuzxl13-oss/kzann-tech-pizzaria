# Segurança

## Isolamento entre pizzarias (multi-tenant)
- **Row Level Security** em todas as tabelas de estabelecimento, com `FORCE ROW LEVEL SECURITY`. A aplicação conecta com um papel **sem** `SUPERUSER` e **sem** `BYPASSRLS` (`kzann_app`). As migrações rodam com outro papel, o dono do schema.
- O contexto (`app.tenant_id`) é definido com `set_config(..., true)` dentro de cada transação, então nunca vaza entre conexões do pool.
- O `tenant_id` vem **sempre da sessão** do usuário, nunca do corpo da requisição.
- Chaves estrangeiras ignoram o RLS, por isso o código valida explicitamente que a categoria e os tamanhos referenciados pertencem ao estabelecimento.
- Os testes automatizados verificam o isolamento pela API e diretamente no banco (sem contexto não há linhas; inserir com o `tenant_id` de outra pizzaria é rejeitado).

## Autenticação e sessão
- Senhas com **Argon2id** (parâmetros OWASP: 19 MiB, t=2, p=1). Política mínima de 8 caracteres com letras e números.
- Login com tempo constante (hash fictício quando o e-mail não existe) e rate limit (10/min por IP).
- Sessão com token aleatório de 256 bits em cookie `httpOnly`, `SameSite=Lax`, `Secure` em HTTPS. No banco fica só o **hash SHA-256** do token, e as sessões podem ser revogadas.
- Trocar a senha encerra as demais sessões. Desativar um funcionário encerra as sessões dele.
- Funcionários recebem senha temporária, exibida uma única vez, com troca obrigatória no primeiro acesso.

## CSRF, XSS e cabeçalhos
- Toda requisição que altera estado em `/api/auth` e `/api/admin` exige o cabeçalho `x-kzann-csrf: 1`. Como o servidor não habilita CORS, outro site não consegue enviá-lo. Isso vale junto com o `SameSite=Lax`.
- `@fastify/helmet` com CSP restritiva (`script-src 'self'`, `frame-ancestors 'none'`), HSTS em HTTPS e `nosniff`.
- O React escapa o conteúdo por padrão. O código não usa `dangerouslySetInnerHTML`.

## Validação e regras de negócio
- Toda entrada passa por esquemas **Zod**. As consultas SQL são parametrizadas.
- Preços, taxas, descontos e totais são **recalculados no servidor**. O cupom é bloqueado com `FOR UPDATE` para respeitar o limite de usos sob concorrência.
- Os números de pedido são sequenciais por pizzaria, com bloqueio de linha.
- O acompanhamento público usa um token aleatório de 192 bits, que não dá para adivinhar.

## Pagamentos
- **Nenhum pagamento online é simulado.** O Pix online usa a API oficial do Mercado Pago:
  1. a cobrança é criada com `X-Idempotency-Key`;
  2. o webhook só é aceito com **assinatura HMAC-SHA256 válida** (`x-signature`) e timestamp dentro de 10 min;
  3. o sistema **consulta o pagamento na API** com o token da pizzaria e confere `external_reference` e valor antes de marcar como pago;
  4. os eventos são idempotentes (`webhook_events`), e uma reconciliação periódica cobre webhooks perdidos.
- As credenciais do gateway ficam criptografadas com **AES-256-GCM** (`ENCRYPTION_KEY`) e nunca voltam na API.
- Pagamentos na entrega e Pix pela chave são confirmados **manualmente** pela equipe, e o painel indica isso claramente.

## Uploads
- Somente PNG, JPG ou WEBP, verificados pelos **bytes mágicos** (não pela extensão), com até 3 MB. O nome do arquivo é aleatório e o diretório é separado por pizzaria.

## Auditoria e LGPD
- `order_events` registra cada mudança do pedido e quem a fez. `audit_logs` registra alterações administrativas (cardápio, configurações, equipe, caixa).
- O sistema coleta só os dados necessários ao pedido (nome, telefone, endereço; e-mail apenas para o Pix online, exigido pelo processador). Os dados do cliente ficam isolados por pizzaria.

## Recomendações de operação
- Use HTTPS (obrigatório para cookies `Secure`, PWA e notificações).
- Configure `TRUST_PROXY=true` atrás de proxy, para o rate limit e os IPs funcionarem corretamente.
- Faça backups automáticos do PostgreSQL e do diretório de uploads.
- Faça a rotação da `ENCRYPTION_KEY` com um script de recriptografia. Uma chave nova não lê os segredos antigos.
