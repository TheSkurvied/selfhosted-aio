#!/usr/bin/env bash
# Run the real AIOStreams server from source for integration tests.
#
#   scripts/upstream/aiostreams.sh build          pnpm install + build crypto, core, server (no SPA)
#   scripts/upstream/aiostreams.sh start          start on :13000, wait for /api/v1/health
#   scripts/upstream/aiostreams.sh start-auth     same, with AIOSTREAMS_AUTH_REQUIRED=true (login path)
#   scripts/upstream/aiostreams.sh stop | status | logs | reset
#
# Env overrides: AIOSTREAMS_SRC (clone dir), AIOSTREAMS_PORT (13000).
#
# Dev values (not secrets):
#   SECRET_KEY  = 000102...1f (fixed, so the SQLite data survives restarts)
#   AIOSTREAMS_AUTH = manager:managerpass, with manager=admin
#
# NOTE: packages/core depends on "github:viren070/torbox-sdk-js#dist", which pnpm
# fetches from codeload.github.com. The sandbox proxy refuses codeload (403), so
# `build` clones that repo with git at the exact commit pinned in pnpm-lock.yaml
# and points a pnpm override at the local copy. The content is identical to the
# tarball pnpm would have fetched. Set AIOSTREAMS_NO_TORBOX_OVERRIDE=1 to skip
# this on a network where codeload works.

# shellcheck source=./common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SRC="${AIOSTREAMS_SRC:-$UPSTREAM_DIR/src/AIOStreams}"
PORT="${AIOSTREAMS_PORT:-13000}"
RUN_DIR="$UPSTREAM_DIR/aiostreams"
PIDFILE="$RUN_DIR/aiostreams.pid"
LOG="$RUN_DIR/aiostreams.log"
DEV_SECRET_KEY=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f

torbox_override() {
	[[ "${AIOSTREAMS_NO_TORBOX_OVERRIDE:-}" == 1 ]] && return
	grep -q '"@torbox/torbox-api"' "$SRC/pnpm-workspace.yaml" && return
	local commit
	commit="$(grep -o 'torbox-sdk-js/tar.gz/[0-9a-f]*' "$SRC/pnpm-lock.yaml" | head -1 | sed 's#.*/##')"
	[[ -n "$commit" ]] || die "could not find the torbox-sdk-js commit in pnpm-lock.yaml"
	local dir="$TOOLS_DIR/torbox-sdk-js-$commit"
	if [[ ! -d "$dir" ]]; then
		log "cloning viren070/torbox-sdk-js@$commit (codeload is blocked)"
		git clone -q https://github.com/viren070/torbox-sdk-js "$dir"
		git -C "$dir" checkout -q "$commit"
	fi
	printf '\noverrides:\n  "@torbox/torbox-api": "file:%s"\n' "$dir" >>"$SRC/pnpm-workspace.yaml"
}

build() {
	ensure_pnpm11
	ensure_clone "$SRC" https://github.com/Viren070/AIOStreams
	cd "$SRC"
	if [[ ! -d node_modules ]]; then
		torbox_override
		log "pnpm install (AIOStreams)"
		CI=true pnpm install --no-frozen-lockfile
	fi
	if [[ ! -f packages/server/dist/server.js ]]; then
		log "building crypto, core, server"
		pnpm -F crypto run build
		pnpm -F core run build
		pnpm -F server run build
	fi
	if [[ "${AIOSTREAMS_BUILD_FRONTEND:-}" == 1 && ! -d packages/frontend/dist ]]; then
		pnpm -F frontend run build
	fi
}

start() {
	local auth_required="${1:-false}"
	if pid_alive "$PIDFILE"; then
		log "aiostreams already running (pid $(cat "$PIDFILE"))"
		return
	fi
	build
	mkdir -p "$RUN_DIR/data"
	cd "$SRC"
	env \
		PORT="$PORT" \
		BASE_URL="http://localhost:$PORT" \
		SECRET_KEY="$DEV_SECRET_KEY" \
		DATABASE_URI="sqlite://$RUN_DIR/data/db.sqlite" \
		NODE_ENV=production \
		LOG_LEVEL="${AIOSTREAMS_LOG_LEVEL:-info}" \
		AIOSTREAMS_AUTH=manager:managerpass \
		AIOSTREAMS_AUTH_PERMISSIONS=manager=admin \
		AIOSTREAMS_AUTH_REQUIRED="$auth_required" \
		USER_CREATE_RATE_LIMIT_MAX_REQUESTS=10000 \
		USER_API_RATE_LIMIT_MAX_REQUESTS=10000 \
		LOGIN_RATE_LIMIT_MAX_REQUESTS=10000 \
		nohup node --max-semi-space-size=8 packages/server/dist/server.js >"$LOG" 2>&1 &
	echo $! >"$PIDFILE"
	echo "$auth_required" >"$RUN_DIR/auth-required"
	wait_http "http://localhost:$PORT/api/v1/health" 120 aiostreams "$PIDFILE"
}

stop() { stop_pid "$PIDFILE" aiostreams; }

status() {
	if pid_alive "$PIDFILE"; then
		echo "aiostreams: running (pid $(cat "$PIDFILE")) http://localhost:$PORT auth_required=$(cat "$RUN_DIR/auth-required" 2>/dev/null)"
		curl -fsS "http://localhost:$PORT/api/v1/health" && echo
	else
		echo "aiostreams: stopped"
		return 1
	fi
}

case "${1:-}" in
build) build ;;
start) start false ;;
start-auth) start true ;;
stop) stop ;;
restart) stop && start "$(cat "$RUN_DIR/auth-required" 2>/dev/null || echo false)" ;;
status) status ;;
logs) tail -n "${2:-100}" "$LOG" ;;
reset) stop && rm -rf "$RUN_DIR/data" && log "data wiped" ;;
*)
	echo "usage: $0 {build|start|start-auth|stop|restart|status|logs|reset}" >&2
	exit 2
	;;
esac
