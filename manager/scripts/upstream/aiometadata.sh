#!/usr/bin/env bash
# Run the real AIOMetadata backend from source for integration tests.
#
#   scripts/upstream/aiometadata.sh build    install deps + compile the backend (tsc)
#   scripts/upstream/aiometadata.sh start    start redis 8 + AIOMetadata on :13232, wait for /health/live
#   scripts/upstream/aiometadata.sh stop     stop both
#   scripts/upstream/aiometadata.sh status   print state (exit 1 if not running)
#   scripts/upstream/aiometadata.sh logs     tail the service log
#   scripts/upstream/aiometadata.sh reset    stop and wipe the SQLite data dir
#
# Env overrides: AIOMETADATA_SRC (clone dir), AIOMETADATA_PORT (13232),
# AIOMETADATA_REDIS_PORT (16379).
#
# Dev values (not secrets): ADMIN_KEY=dev-admin-key, ADDON_PASSWORD=dev-addon-password.
# No external API keys are set, so configs must carry apiKeys.tmdb themselves
# (any non-empty string passes validation; see tests/mocks/README.md).

# shellcheck source=./common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SRC="${AIOMETADATA_SRC:-$UPSTREAM_DIR/src/aiometadata}"
PORT="${AIOMETADATA_PORT:-13232}"
REDIS_PORT="${AIOMETADATA_REDIS_PORT:-16379}"
RUN_DIR="$UPSTREAM_DIR/aiometadata"
PIDFILE="$RUN_DIR/aiometadata.pid"
REDIS_PIDFILE="$RUN_DIR/redis.pid"
LOG="$RUN_DIR/aiometadata.log"

build() {
	ensure_node24
	ensure_clone "$SRC" https://github.com/cedya77/aiometadata
	cd "$SRC"
	if [[ ! -d node_modules ]]; then
		log "npm ci (aiometadata)"
		npm ci --no-audit --no-fund
	fi
	# npm 11 skips install scripts unless allow-listed; these two are native.
	if [[ ! -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]]; then
		npm rebuild better-sqlite3 bcrypt
	fi
	if [[ ! -f dist/server/server.js ]]; then
		log "compiling backend"
		npm run build:backend
	fi
}

start_redis() {
	ensure_redis8
	mkdir -p "$RUN_DIR"
	if pid_alive "$REDIS_PIDFILE"; then
		return
	fi
	"$REDIS8_DIR/bin/redis-server" --port "$REDIS_PORT" --bind 127.0.0.1 --save '' --appendonly no \
		--daemonize yes --pidfile "$REDIS_PIDFILE" --logfile "$RUN_DIR/redis.log" --dir "$RUN_DIR"
	for _ in $(seq 1 20); do
		"$REDIS8_DIR/bin/redis-cli" -p "$REDIS_PORT" ping >/dev/null 2>&1 && break
		sleep 0.2
	done
	log "redis $("$REDIS8_DIR/bin/redis-server" --version | grep -o 'v=[0-9.]*') on :$REDIS_PORT"
}

start() {
	if pid_alive "$PIDFILE"; then
		log "aiometadata already running (pid $(cat "$PIDFILE"))"
		return
	fi
	build
	start_redis
	mkdir -p "$RUN_DIR/data"
	cd "$SRC"
	env \
		PORT="$PORT" \
		HOST_NAME="http://localhost:$PORT" \
		ADMIN_KEY=dev-admin-key \
		ADDON_PASSWORD=dev-addon-password \
		NODE_ENV=production \
		DATABASE_URI="sqlite://$RUN_DIR/data/db.sqlite" \
		REDIS_URL="redis://127.0.0.1:$REDIS_PORT" \
		ENABLE_CACHE_WARMING=false \
		MAL_WARMUP_ENABLED=false \
		TMDB_POPULAR_WARMING_ENABLED=false \
		CATALOG_WARMUP_AUTO_ON_EPOCH_CHANGE=false \
		CACHE_CLEANUP_AUTO_ENABLED=false \
		nohup node dist/server/server.js >"$LOG" 2>&1 &
	echo $! >"$PIDFILE"
	wait_http "http://localhost:$PORT/health/live" 90 aiometadata "$PIDFILE"
	# /health/live answers before the readiness gate opens; the API needs ready.
	local deadline=$((SECONDS + 90))
	until curl -fsS -o /dev/null "http://localhost:$PORT/api/config/addon-info"; do
		((SECONDS < deadline)) || die "aiometadata API not ready (see $LOG)"
		sleep 0.5
	done
	log "aiometadata API ready"
}

stop() {
	stop_pid "$PIDFILE" aiometadata
	if pid_alive "$REDIS_PIDFILE"; then
		"$REDIS8_DIR/bin/redis-cli" -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
		rm -f "$REDIS_PIDFILE"
		log "redis stopped"
	fi
}

status() {
	local rc=0
	if pid_alive "$PIDFILE"; then
		echo "aiometadata: running (pid $(cat "$PIDFILE")) http://localhost:$PORT"
		curl -fsS "http://localhost:$PORT/health/live" && echo || rc=1
	else
		echo "aiometadata: stopped"
		rc=1
	fi
	if pid_alive "$REDIS_PIDFILE"; then echo "redis: running :$REDIS_PORT"; else echo "redis: stopped"; fi
	return $rc
}

case "${1:-}" in
build) build ;;
start) start ;;
stop) stop ;;
restart) stop && start ;;
status) status ;;
logs) tail -n "${2:-100}" "$LOG" ;;
reset) stop && rm -rf "$RUN_DIR/data" && log "data wiped" ;;
*)
	echo "usage: $0 {build|start|stop|restart|status|logs|reset}" >&2
	exit 2
	;;
esac
