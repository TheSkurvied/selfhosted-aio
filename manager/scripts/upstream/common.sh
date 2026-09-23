# shellcheck shell=bash
# Shared helpers for scripts/upstream/*.sh. Source it; do not run it.
#
# Layout (all under manager/.upstream/, which is gitignored):
#   tools/node-v24.x/      Node 24 (both upstreams require >=24; the manager uses 22)
#   tools/pnpm11/          pnpm 11 (AIOStreams requires >=11; the manager uses 10)
#   tools/redis-8.x/bin/   redis-server 8 built from source (AIOMetadata needs HSETEX/HTTL)
#   src/AIOStreams, src/aiometadata   upstream clones (override with AIOSTREAMS_SRC / AIOMETADATA_SRC)
#   <service>/             data dir, pid file and log for each running service

set -euo pipefail

MANAGER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPSTREAM_DIR="${UPSTREAM_DIR:-$MANAGER_DIR/.upstream}"
TOOLS_DIR="$UPSTREAM_DIR/tools"

NODE24_VERSION="${NODE24_VERSION:-v24.21.0}"
PNPM11_VERSION="${PNPM11_VERSION:-11.0.8}"
REDIS8_TAG="${REDIS8_TAG:-8.2.2}"

NODE24_DIR="$TOOLS_DIR/node-$NODE24_VERSION-linux-x64"
PNPM11_DIR="$TOOLS_DIR/pnpm11"
REDIS8_DIR="$TOOLS_DIR/redis-$REDIS8_TAG"

log() { printf '[upstream] %s\n' "$*" >&2; }
die() { printf '[upstream] error: %s\n' "$*" >&2; exit 1; }

ensure_node24() {
	if [[ ! -x "$NODE24_DIR/bin/node" ]]; then
		log "downloading node $NODE24_VERSION"
		mkdir -p "$TOOLS_DIR"
		local tarball="$TOOLS_DIR/node-$NODE24_VERSION.tar.xz"
		curl -fsSL -o "$tarball" "https://nodejs.org/dist/$NODE24_VERSION/node-$NODE24_VERSION-linux-x64.tar.xz"
		tar -xJf "$tarball" -C "$TOOLS_DIR"
		rm -f "$tarball"
	fi
	export PATH="$NODE24_DIR/bin:$PATH"
}

ensure_pnpm11() {
	ensure_node24
	if [[ ! -x "$PNPM11_DIR/bin/pnpm" ]]; then
		log "installing pnpm $PNPM11_VERSION"
		npm install -g "pnpm@$PNPM11_VERSION" --prefix "$PNPM11_DIR" >/dev/null
	fi
	export PATH="$PNPM11_DIR/bin:$PATH"
}

# Redis >= 8 is required by AIOMetadata (HSETEX / HTTL). Ubuntu 24.04 ships 7.0,
# download.redis.io is blocked by the sandbox proxy, and redis-memory-server
# downloads from the same host. Building the tag from a git clone works.
ensure_redis8() {
	if [[ -x "$REDIS8_DIR/bin/redis-server" ]]; then
		return
	fi
	local sys
	sys="$(command -v redis-server || true)"
	if [[ -n "$sys" ]] && "$sys" --version | grep -Eq 'v=([89]|[1-9][0-9])\.'; then
		mkdir -p "$REDIS8_DIR/bin"
		ln -sf "$sys" "$REDIS8_DIR/bin/redis-server"
		ln -sf "$(command -v redis-cli)" "$REDIS8_DIR/bin/redis-cli"
		return
	fi
	log "building redis $REDIS8_TAG from source (about 2 minutes)"
	local src="$TOOLS_DIR/redis-src-$REDIS8_TAG"
	if [[ ! -d "$src" ]]; then
		git clone -q --depth 1 --branch "$REDIS8_TAG" https://github.com/redis/redis "$src"
	fi
	make -C "$src" -j"$(nproc)" BUILD_TLS=no MALLOC=libc >"$TOOLS_DIR/redis-build.log" 2>&1 ||
		die "redis build failed, see $TOOLS_DIR/redis-build.log"
	mkdir -p "$REDIS8_DIR/bin"
	cp "$src/src/redis-server" "$src/src/redis-cli" "$REDIS8_DIR/bin/"
}

# ensure_clone <dir> <git url>
ensure_clone() {
	local dir="$1" url="$2"
	if [[ ! -d "$dir/.git" && ! -f "$dir/package.json" ]]; then
		log "cloning $url into $dir"
		mkdir -p "$(dirname "$dir")"
		git clone -q --depth 1 "$url" "$dir"
	fi
}

# pid_alive <pidfile>
pid_alive() {
	[[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null
}

# stop_pid <pidfile> <name>
stop_pid() {
	local pidfile="$1" name="$2"
	if pid_alive "$pidfile"; then
		local pid
		pid="$(cat "$pidfile")"
		kill "$pid" 2>/dev/null || true
		for _ in $(seq 1 50); do
			kill -0 "$pid" 2>/dev/null || break
			sleep 0.2
		done
		kill -9 "$pid" 2>/dev/null || true
		log "$name stopped"
	else
		log "$name not running"
	fi
	rm -f "$pidfile"
}

# wait_http <url> <timeout seconds> <name> [pidfile]
wait_http() {
	local url="$1" timeout="$2" name="$3" pidfile="${4:-}"
	local deadline=$((SECONDS + timeout))
	while ((SECONDS < deadline)); do
		if curl -fsS -o /dev/null --max-time 2 "$url"; then
			log "$name ready at $url"
			return 0
		fi
		if [[ -n "$pidfile" ]] && ! pid_alive "$pidfile"; then
			die "$name exited during startup"
		fi
		sleep 0.5
	done
	die "$name not ready after ${timeout}s ($url)"
}
