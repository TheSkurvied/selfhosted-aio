#!/usr/bin/env bash
# Creates one role + one database per app. Runs automatically ONLY on the very
# first start of the postgres container (empty data directory).
#
# It is idempotent, so it can be re-run later (e.g. after adding a database):
#   docker compose exec postgres bash /docker-entrypoint-initdb.d/10-create-databases.sh
#
# Passwords come from the postgres service environment (see compose.yaml).
# Changing a password in .env later does NOT update the role; run
#   docker compose exec postgres psql -U postgres -c "ALTER ROLE aiostreams PASSWORD '...'"
set -euo pipefail

create_db() {
	local user="$1" pass="$2" db="$3"
	if [ -z "$pass" ]; then
		echo "init: password for role '$user' is empty, refusing to continue" >&2
		exit 1
	fi
	psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname postgres \
		-v user="$user" -v pass="$pass" -v db="$db" <<-'SQL'
		SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'user', :'pass')
		WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'user')\gexec
		SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user')
		WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')\gexec
		SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db')\gexec
		SELECT format('GRANT ALL ON DATABASE %I TO %I', :'db', :'user')\gexec
	SQL
	echo "init: role '$user' and database '$db' ready"
}

create_db aiostreams  "${AIOSTREAMS_DB_PASSWORD:-}"  aiostreams
create_db aiometadata "${AIOMETADATA_DB_PASSWORD:-}" aiometadata
create_db manager     "${MANAGER_DB_PASSWORD:-}"     manager
