-- KZ-04: envio repetido do checkout (rede instável, toque duplo) criava pedidos duplicados.
-- O cliente envia uma chave única por tentativa de checkout; a mesma chave devolve o mesmo pedido.
ALTER TABLE orders ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX orders_tenant_idempotency_key ON orders (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
