#!/bin/bash
# Strapi owns its own database and its own schema lifecycle. It never touches
# the core database, and the core migrations never touch this one.
#
# A shell script and not the .sql this replaced: a file in
# docker-entrypoint-initdb.d cannot interpolate, so the password would have had
# to be written in the file and committed. Production would then have run with
# the local development password while quietly ignoring whatever compose passed.
#
# Runs once, on an empty volume. After that the role and database exist and this
# is never read again — changing the password later is an ALTER ROLE by hand.
set -euo pipefail

: "${CMS_DB_PASSWORD:?init-cms-db.sh needs CMS_DB_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE ROLE mbs_cms WITH LOGIN PASSWORD '${CMS_DB_PASSWORD}';
	CREATE DATABASE mbs_cms OWNER mbs_cms;
SQL
