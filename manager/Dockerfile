# AIO Manager: SvelteKit (adapter-node) + Drizzle/Postgres.
# Shell tools in the image:
#   node build/cli/reset-admin.mjs <email> [--password] [--totp] [--create]
#   OLD_MANAGER_KEY=... node build/cli/rotate-key.mjs [--dry-run]

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# ---- build: full deps, compile, then prune to production deps
FROM base AS build
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 && node scripts/build-cli.mjs \
 && pnpm prune --prod --ignore-scripts

# ---- runtime
FROM node:22-alpine AS runtime
RUN apk add --no-cache wget tini \
 && addgroup -S app && adduser -S -G app -h /app app
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 MIGRATIONS_DIR=/app/drizzle
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/build ./build
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
