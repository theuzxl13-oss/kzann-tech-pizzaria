-- KZ-05: excluir uma categoria apagava em cascata todos os sabores/produtos dela.
-- Agora a exclusão é bloqueada enquanto houver itens vinculados (mova-os ou oculte a categoria).
ALTER TABLE pizza_flavors
  DROP CONSTRAINT pizza_flavors_category_id_fkey,
  ADD CONSTRAINT pizza_flavors_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT;

ALTER TABLE products
  DROP CONSTRAINT products_category_id_fkey,
  ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT;
