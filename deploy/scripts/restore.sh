#!/usr/bin/env bash
# Restore from the restic repository written by backup.sh.
#
# Usage (run as root from anywhere; the deploy dir is found from this path):
#   scripts/restore.sh list                  list snapshots
#   scripts/restore.sh verify   [SNAPSHOT]   restore test: load every dump into a
#                                            throwaway postgres:17 container and
#                                            count tables. Touches nothing live.
#   scripts/restore.sh config   [SNAPSHOT]   extract .env/Caddyfile/... into
#                                            deploy/restored-config/ for review
#   scripts/restore.sh full     [SNAPSHOT]   replace the live databases and data
#                                            dirs with the snapshot (asks first)
#   scripts/restore.sh full-local DIR        same, from a local staging dir
#                                            (e.g. /var/backups/aio after
#                                            update.sh's pre-update backup)
# SNAPSHOT defaults to "latest".
#
# Fresh-server recovery:
#   1. bootstrap.sh, clone this repo to /opt/aio
#   2. export RESTIC_REPOSITORY=... RESTIC_PASSWORD=...  (from your password manager)
#   3. scripts/restore.sh config  -> review, then cp restored-config/.env .env
#   4. docker compose up -d postgres   (init script recreates roles from .env)
#   5. scripts/restore.sh full
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

cmd="${1:-}"
VERIFY_CONTAINER="aio-restore-verify"
snap="${2:-latest}"

# restore_snapshot SNAPSHOT TARGET -> sets SRC to the staging dir inside TARGET
restore_snapshot() {
	local snapshot="$1" target="$2" staging
	load_restic_env
	staging="$(env_get BACKUP_STAGING_DIR /var/backups/aio)"
	log "restoring snapshot $snapshot to $target"
	restic restore "$snapshot" --host aio --target "$target"
	SRC="$target$staging"
	[ -d "$SRC/db" ] || die "snapshot does not contain $staging/db (was BACKUP_STAGING_DIR changed?)"
}

verify() {
	local src="$1" name="$VERIFY_CONTAINER" db tables
	log "starting throwaway postgres:17 ($name)"
	docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=verify postgres:17 >/dev/null
	for _ in $(seq 1 30); do
		docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break
		sleep 2
	done
	for db in "${APP_DBS[@]}"; do
		[ -f "$src/db/$db.dump" ] || die "missing $db.dump"
		docker exec "$name" createdb -U postgres "$db"
		docker exec -i "$name" pg_restore -U postgres -d "$db" --no-owner --no-acl --exit-on-error <"$src/db/$db.dump"
		tables="$(docker exec "$name" psql -U postgres -d "$db" -tAc \
			"select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')")"
		log "  $db: restored OK, $tables tables"
	done
	tar -tzf "$src/files/data.tar.gz" >/dev/null && log "  data.tar.gz: readable"
	tar -tzf "$src/files/config.tar.gz" | grep -qx '.env' && log "  config.tar.gz: contains .env"
	log "restore test passed"
}

full_restore() {
	local src="$1" db
	echo "This REPLACES the live databases (${APP_DBS[*]}) and data dirs in $DEPLOY_DIR/data"
	echo "with the contents of $src. Type 'restore' to continue:"
	read -r answer
	[ "$answer" = "restore" ] || die "aborted"

	log "stopping app services"
	dc stop caddy "${APP_SERVICES[@]}" || true
	dc up -d postgres
	wait_healthy postgres 120 || die "postgres is not healthy"
	for db in "${APP_DBS[@]}"; do
		dc exec -T postgres dropdb -U postgres --if-exists --force "$db"
	done
	# Recreate roles (if missing) and empty databases owned by them. Idempotent;
	# role passwords come from .env. Role name == database name.
	dc exec -T postgres bash /docker-entrypoint-initdb.d/10-create-databases.sh

	for db in "${APP_DBS[@]}"; do
		log "restoring database $db"
		dc exec -T postgres pg_restore -U postgres -d "$db" --no-owner --role="$db" \
			--exit-on-error <"$src/db/$db.dump"
	done

	log "restoring data directories"
	local stamp; stamp="$(date +%Y%m%d%H%M%S)"
	for d in aiostreams aiometadata caddy; do
		if [ -d "$DEPLOY_DIR/data/$d" ]; then
			mv "$DEPLOY_DIR/data/$d" "$DEPLOY_DIR/data/$d.pre-restore-$stamp"
		fi
	done
	tar -C "$DEPLOY_DIR" -xzf "$src/files/data.tar.gz"
	log "old data dirs kept as data/*.pre-restore-$stamp (delete once happy)"

	log "starting stack"
	dc up -d
	for s in aiostreams aiometadata aio-manager caddy; do wait_healthy "$s" 240 || true; done
	log "restore done"
}

case "$cmd" in
	list)
		load_restic_env
		restic snapshots --host aio
		;;
	verify)
		tmp="$(mktemp -d)"
		trap 'rm -rf "$tmp"; docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true' EXIT
		restore_snapshot "$snap" "$tmp"
		verify "$SRC"
		;;
	config)
		tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
		restore_snapshot "$snap" "$tmp"
		mkdir -p "$DEPLOY_DIR/restored-config"
		tar -C "$DEPLOY_DIR/restored-config" -xzf "$SRC/files/config.tar.gz"
		chmod 600 "$DEPLOY_DIR/restored-config/.env"
		log "extracted to $DEPLOY_DIR/restored-config (review, then copy .env into place)"
		;;
	full)
		tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
		restore_snapshot "$snap" "$tmp"
		full_restore "$SRC"
		;;
	full-local)
		[ -n "${2:-}" ] || die "usage: restore.sh full-local DIR"
		full_restore "$2"
		;;
	*)
		sed -n '2,24p' "$0"
		exit 1
		;;
esac
