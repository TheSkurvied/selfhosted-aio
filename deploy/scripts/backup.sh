#!/usr/bin/env bash
# Nightly backup: pg_dump of each database + tarball of the app data dirs and
# config, pushed to an off-site restic repository (Hetzner Storage Box or S3).
#
# Usage:
#   scripts/backup.sh               dump, tar, restic backup, prune
#   scripts/backup.sh --local-only  dump + tar into BACKUP_STAGING_DIR only
#                                   (used by update.sh before pulling images)
#
# Cron (installed by bootstrap.sh as /etc/cron.d/aio-backup). Runs as root
# because the container data dirs (e.g. Caddy certs) are root-owned:
#   30 3 * * * root /opt/aio/deploy/scripts/backup.sh >> /var/log/aio-backup.log 2>&1
#
# What is backed up:
#   db/<name>.dump      pg_dump -Fc of aiostreams, aiometadata, manager
#   db/globals.sql      roles (for reference; restore.sh recreates roles from .env)
#   files/data.tar.gz   data/aiostreams, data/aiometadata, data/caddy
#                       (without rebuildable caches)
#   files/config.tar.gz .env, Caddyfile, compose.yaml, postgres-init/
# NOT backed up: data/postgres (covered by the dumps), data/redis-aiometadata
# (pure cache).
#
# .env holds SECRET_KEY and every password. The restic repository is
# encrypted with RESTIC_PASSWORD, which must also be stored outside the server.
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

LOCAL_ONLY=0
[ "${1:-}" = "--local-only" ] && LOCAL_ONLY=1

STAGING="$(env_get BACKUP_STAGING_DIR /var/backups/aio)"
LOCK="$STAGING/.lock"
mkdir -p "$STAGING"
exec 9>"$LOCK"
flock -n 9 || die "another backup is running"

umask 077
rm -rf "$STAGING/db" "$STAGING/files"
mkdir -p "$STAGING/db" "$STAGING/files"

log "dumping databases"
dc exec -T postgres pg_dumpall -U postgres --globals-only >"$STAGING/db/globals.sql"
for db in "${APP_DBS[@]}"; do
	dc exec -T postgres pg_dump -U postgres -Fc --no-owner "$db" >"$STAGING/db/$db.dump"
	# sanity check: the archive must list its contents
	dc exec -T postgres pg_restore --list <"$STAGING/db/$db.dump" >/dev/null \
		|| die "dump of $db is not readable"
	log "  $db: $(du -h "$STAGING/db/$db.dump" | cut -f1)"
done

log "archiving data directories"
tar -C "$DEPLOY_DIR" -czf "$STAGING/files/data.tar.gz" \
	--exclude='data/aiostreams/cache' \
	--exclude='data/aiometadata/poster-cache' \
	--exclude='data/aiometadata/metacache.sqlite*' \
	--ignore-failed-read \
	data/aiostreams data/aiometadata data/caddy
tar -C "$DEPLOY_DIR" -czf "$STAGING/files/config.tar.gz" \
	.env Caddyfile compose.yaml postgres-init
log "  data: $(du -h "$STAGING/files/data.tar.gz" | cut -f1)"

if [ "$LOCAL_ONLY" = 1 ]; then
	log "local-only backup done: $STAGING"
	exit 0
fi

load_restic_env
if ! restic cat config >/dev/null 2>&1; then
	log "initialising restic repository $RESTIC_REPOSITORY"
	restic init
fi

log "restic backup"
restic backup --host aio --tag nightly "$STAGING/db" "$STAGING/files"

log "restic forget/prune"
restic forget --host aio --tag nightly --prune \
	--keep-daily "$(env_get BACKUP_KEEP_DAILY 7)" \
	--keep-weekly "$(env_get BACKUP_KEEP_WEEKLY 4)" \
	--keep-monthly "$(env_get BACKUP_KEEP_MONTHLY 6)"

# Read 1/7 of the pack data each night: a full verification every week.
restic check --read-data-subset="$(( $(date +%u) ))/7"

log "backup done"
