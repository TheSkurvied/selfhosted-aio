#!/usr/bin/env bash
# Pull newer images for the pinned tags and recreate changed containers.
#
# Usage:  scripts/update.sh [--yes] [SERVICE...]
#   --yes      skip the "read the changelogs" confirmation (for scripted runs)
#   SERVICE    only update these services (default: all)
#
# BEFORE running, read the upstream release notes since your current version:
#   AIOStreams   https://github.com/Viren070/AIOStreams/releases
#                Migration guides: https://docs.aiostreams.viren070.me/migrations/
#                (e.g. v2.30 split settings into bootstrap env vs dashboard
#                runtime settings). Database migrations run on start and are
#                one-way: the pre-update dump below is your rollback.
#   AIOMetadata  https://github.com/cedya77/aiometadata/releases
#                (CHANGELOG.md; watch for Redis version or env var renames)
#   aio-manager  our own release notes
#   Caddy, Postgres, Redis: major tags are pinned (caddy:2, postgres:17,
#   redis:8), so pulls only bring minor/patch releases. A Postgres MAJOR
#   upgrade (17 -> 18) needs dump/restore and is never done by this script.
#
# Rollback: set AIOSTREAMS_TAG / AIOMETADATA_TAG in .env to the previous exact
# version (e.g. v2.34.1 / 3.0.0), then
#   scripts/restore.sh full-local /var/backups/aio   (only if a DB migration ran)
#   docker compose up -d
set -euo pipefail
# shellcheck source=_common.sh
. "$(dirname "$0")/_common.sh"

ASSUME_YES=0
if [ "${1:-}" = "--yes" ]; then ASSUME_YES=1; shift; fi
SERVICES=("$@")

if [ "$ASSUME_YES" != 1 ]; then
	sed -n '8,19p' "$0"
	printf 'Have you read the changelogs? [y/N] '
	read -r ok
	[ "$ok" = "y" ] || [ "$ok" = "Y" ] || die "aborted"
fi

log "current images"
dc images

log "pre-update local backup (dumps + data tarball)"
"$DEPLOY_DIR/scripts/backup.sh" --local-only

log "pulling images"
dc pull "${SERVICES[@]}"

log "recreating changed containers"
dc up -d --remove-orphans "${SERVICES[@]}"

rc=0
for s in postgres redis-aiometadata aiostreams aiometadata aio-manager caddy; do
	if [ "${#SERVICES[@]}" -gt 0 ] && [[ " ${SERVICES[*]} " != *" $s "* ]]; then continue; fi
	wait_healthy "$s" 300 || rc=1
done

log "new images"
dc images

log "removing dangling images"
docker image prune -f >/dev/null

if [ "$rc" != 0 ]; then
	log "some services are not healthy. Check: docker compose logs --tail=200 <service>"
	exit 1
fi
log "update done"
