#!/usr/bin/env bash
# Shared helpers for backup.sh, restore.sh and update.sh. Source, do not run.

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# env_get KEY [DEFAULT]
# Reads KEY from .env without sourcing it (values may contain spaces or
# characters that are not valid shell). An already-exported variable wins.
env_get() {
	local key="$1" default="${2:-}" val=""
	if [ -n "${!key:-}" ]; then
		printf '%s' "${!key}"
		return
	fi
	if [ -f "$ENV_FILE" ]; then
		val="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
		# strip one pair of surrounding quotes
		val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
	fi
	printf '%s' "${val:-$default}"
}

# Export restic settings from .env (or the caller's environment).
load_restic_env() {
	export RESTIC_REPOSITORY RESTIC_PASSWORD
	RESTIC_REPOSITORY="$(env_get RESTIC_REPOSITORY)"
	RESTIC_PASSWORD="$(env_get RESTIC_PASSWORD)"
	[ -n "$RESTIC_REPOSITORY" ] || die "RESTIC_REPOSITORY is not set"
	[ -n "$RESTIC_PASSWORD" ] || die "RESTIC_PASSWORD is not set"
	local k v
	for k in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION; do
		v="$(env_get "$k")"
		if [ -n "$v" ]; then export "$k=$v"; fi
	done
	command -v restic >/dev/null || die "restic is not installed (apt install restic)"
}

dc() { docker compose --project-directory "$DEPLOY_DIR" -f "$DEPLOY_DIR/compose.yaml" "$@"; }

APP_DBS=(aiostreams aiometadata manager)
# Services that write to Postgres; stopped during a restore.
APP_SERVICES=(aio-manager aiostreams aiometadata)

# wait_healthy SERVICE [TIMEOUT_SECONDS]
wait_healthy() {
	local svc="$1" timeout="${2:-180}" id status waited=0
	id="$(dc ps -q "$svc")"
	[ -n "$id" ] || die "service $svc is not running"
	while :; do
		status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
		case "$status" in
			healthy|running) log "$svc: $status"; return 0 ;;
			unhealthy) log "$svc: unhealthy"; return 1 ;;
		esac
		if [ "$waited" -ge "$timeout" ]; then
			log "$svc: still $status after ${timeout}s"
			return 1
		fi
		sleep 5
		waited=$((waited + 5))
	done
}
