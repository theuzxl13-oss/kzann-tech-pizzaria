# Pagamentos

| Forma | Como funciona | Confirmação |
|---|---|---|
| Dinheiro | Cliente informa se precisa de troco; a comanda mostra quanto levar | Equipe confirma, ou automaticamente ao **concluir** o pedido |
| Cartão na entrega/retirada | Maquininha da pizzaria | Igual ao dinheiro |
| Pix pela chave | Cliente vê a chave da pizzaria e envia o comprovante pelo WhatsApp | **Manual**, pela equipe ("Confirmar recebimento") |
| Pix online (Mercado Pago) | QR Code e "copia e cola" gerados pela API oficial | **Automática por webhook assinado** |

## Pix online: configuração por pizzaria
1. Em https://www.mercadopago.com.br/developers, crie uma aplicação e copie o **Access Token** de produção (ou de teste, para homologar).
2. Em **Webhooks**, cadastre a URL exibida em *Configurações → Pagamentos* do painel (`https://SEU-DOMINIO/api/webhooks/mercadopago/<id-da-pizzaria>`), marque o evento **Pagamentos** e copie a **assinatura secreta**.
3. Cole o Access Token e a assinatura no painel, ative a integração e marque "Pix online" nas formas de pagamento.

## Fluxo técnico
1. O cliente finaliza o pedido com Pix online. O pedido fica `awaiting_payment` e **não aparece como novo para a cozinha**.
2. O servidor chama `POST /v1/payments` (`payment_method_id: pix`, `external_reference = id do pedido`, `notification_url`, expiração) com `X-Idempotency-Key`.
3. O cliente vê o QR Code e a página atualiza sozinha.
4. O Mercado Pago chama o webhook, e o servidor:
   - valida `x-signature` (HMAC-SHA256 de `id:{data.id};request-id:{x-request-id};ts:{ts};`);
   - registra o evento (idempotência);
   - consulta `GET /v1/payments/{id}` e confere a referência e o valor;
   - se o status for `approved`, o pedido vai para `pending` (ou `accepted` com aceite automático), o painel toca o alerta e o cliente vê "Pedido enviado".
5. Pix expirado ou recusado: o pedido é cancelado automaticamente e o cupom é devolvido.
6. Um pedido pago online e cancelado pela equipe recebe um pedido de **estorno** automático. Se o estorno falhar, o painel avisa para fazê-lo manualmente.

## Cartão online (futuro)
A camada `server/src/payments` isola o provedor. Para cartão online, use o Checkout Bricks ou o Checkout Pro do Mercado Pago (tokenização no navegador, sem dados de cartão no servidor), reaproveitando o mesmo webhook e a mesma reconciliação.
