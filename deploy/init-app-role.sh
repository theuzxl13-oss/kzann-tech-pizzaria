#!/bin/sh
# Cria o papel da aplicação SEM superuser/BYPASSRLS na primeira inicialização do PostgreSQL.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE kzann_app LOGIN PASSWORD '${KZANN_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT, TEMP ON DATABASE ${POSTGRES_DB} TO kzann_app;
SQL
