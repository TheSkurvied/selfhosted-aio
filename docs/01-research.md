# Research: self-hosting AIOStreams + AIOMetadata (checked 2026-09-23)

## AIOStreams (Viren070/AIOStreams, release v2.34.1, docs already cover v2.35)
- Image: `ghcr.io/viren070/aiostreams` (also `viren070/aiostreams`). Built for amd64 and arm64. Port 3000.
- Volume: `./data:/app/data` holds the SQLite database and the disk caches. Without it, configs are lost when the container is recreated.
- Required settings:
  - `BASE_URL`: the public https URL.
  - `SECRET_KEY`: 64 hex characters (`openssl rand -hex 32`). It encrypts stored configs and **can never be changed**.
- Database: `DATABASE_URI` takes either `sqlite://./data/db.sqlite` or `postgres://...`. Redis is optional and only needed for multi-instance setups.
- Since v2.30 there are two kinds of settings. Bootstrap settings come from env. Runtime settings are edited on `/dashboard` → Settings; if you also set one in env, it is locked in the UI.
- Multi-user is built in. Each config is a server-side user with a UUID and a password, encrypted with `SECRET_KEY`.
- Manifest URLs:
  - Normal: `https://<host>/stremio/<uuid>/<encryptedPassword>/manifest.json`. `POST` returns the `encryptedPassword` segment.
  - Alias: `/stremio/u/<alias>/manifest.json`, set up with `ALIASED_CONFIGURATIONS=alias:uuid:password`.
- User API at `/api/v1/user`:
  - `HEAD`: check whether a user exists.
  - `POST {config, password}`: create a user. Returns `uuid` and `encryptedPassword`.
  - `GET`, `PUT` (full replace), `DELETE`: need `Authorization: Basic base64(uuid:password)`.
- Admin dashboard `/dashboard`, backed by `/api/v1/dashboard/*`:
  - It lists users, search, and deletes them one at a time or in bulk.
  - **It never returns config contents.** An admin cannot see or edit a user's config.
- Restricting access:
  - `AIOSTREAMS_AUTH=user:pass,...` sets the logins. Roles are set with `AIOSTREAMS_AUTH_PERMISSIONS` (`admin|proxy|service|sabnzbd|none`); a user not listed there **defaults to admin**.
  - `AIOSTREAMS_AUTH_REQUIRED=true` puts the configure page behind a login and enforces `CONFIG_ACCESS_KEY`. That key is embedded in every config, so rotating it breaks all configs.
  - OIDC can be set up with `AIOSTREAMS_OIDC_*`.
  - `TRUSTED_UUIDS` lets the listed configs use regex filters.
- Health checks: `GET /api/v1/status` (used by the Docker HEALTHCHECK) and `GET /api/v1/health`, which also checks the database.
- Gotchas:
  - Torrentio and the other strem.fun addons return 403 to some datacenter IPs; Oracle is named. The fix is an upstream proxy: `ADDON_PROXY` + `ADDON_PROXY_CONFIG=*:false,*.strem.fun:true`.
  - When debrid providers limit a stream to one IP, proxy the streams through the built-in proxy, MediaFlow or StremThru.
  - Set a timeout of about 5000 ms per addon.
  - `USER_CREATE_RATE_LIMIT_*` defaults to 10 per IP.

## AIOMetadata (cedya77/aiometadata, v3.0.0 released 2026-09-21)
- Image: `ghcr.io/cedya77/aiometadata`. Built for amd64 and arm64. Port 3232.
  - Pin the `3` tag, because a stray `v5.0.0` tag also exists.
  - Healthchecks: `/health/live` and `/health/ready`.
- **Requires Redis 8 or newer.** It checks for HSETEX/HTTL at startup.
  - `REDIS_AUTOTUNE=true` changes Redis settings for the whole server, so give AIOMetadata its own Redis, or set it to false.
  - Set a `maxmemory` limit.
- Database: `DATABASE_URI` takes SQLite (`sqlite://addon/data/db.sqlite`) or `postgresql://...`. Volume: `/app/addon/data`.
- Env:
  - `HOST_NAME`: the public https URL.
  - `NODE_ENV=production`.
  - `ADMIN_KEY`: the admin key, sent as the `x-admin-key` header.
  - `ADDON_PASSWORD`: an instance password required to create configs.
  - `IMAGE_PROXY_SIGNING_SECRET`.
- API keys:
  - Put them in `BUILT_IN_*_API_KEY`. Those stay on the server.
  - **Never** use the plain `TMDB_API_KEY`-style names on a shared instance: `/api/config` serves them to every visitor.
  - MDBList (charges above 1000 calls/day) and Gemini (charges per query) cost money, so only put them on a private instance.
- Per-user configs are stored under a UUID plus a password:
  - `POST /api/config/save` creates one.
  - `/api/config/load/:uuid` loads it.
  - `/api/config/update/:uuid` updates it.
  - Manifest URL: `{HOST_NAME}/stremio/{uuid}/manifest.json`.
- Admin API (`x-admin-key`):
  - `GET /api/admin/users` (supports `q`, `limit`, `offset`)
  - `GET|DELETE /api/admin/users/:uuid`
  - `POST /api/admin/users/:uuid/reset-password`
  - Export, set or remove an alias, and bulk-delete inactive users.
  - The dashboard is at `/dashboard`.
- Gotchas:
  - **The public Jikan API shuts down on 2026-10-01.** Anime (MAL) catalogs need a self-hosted Jikan.
  - `POSTER_PROXY_ALLOW_PRIVATE=false` blocks SSRF.
  - Cache warming spends upstream API quota.
  - Every user's requests use your `BUILT_IN_` keys.
  - Leave `USER_ALIASES_ENABLED` off, because aliases are guessable.

## Hosting
- Traffic is mostly small JSON: manifests, catalogs and stream lists. Video goes straight from the debrid CDN to the player unless you proxy it.
- IP reputation is the biggest risk: strem.fun/Torrentio sits behind Cloudflare challenges that block datacenter IPs. Oracle is named explicitly.
- Prices (Sep 2026):

  | Host | Price and notes |
  |---|---|
  | Hetzner CX23 | €5.49/mo, 20 TB egress in EU |
  | Hetzner CAX11 (ARM) | €5.99 |
  | OVH VPS-1 | ~$6.46 |
  | Contabo | ~$4.95, poor IP reputation |
  | DigitalOcean | $24 |
  | Vultr | $20 |
  | Fly.io, Railway, Render | $25–60+, no Docker Compose |
  | Oracle Free | limits cut in half on 2026-08-18, terminations reported, blocked by Torrentio |

- Cloudflare CDN/Tunnel terms: proxying JSON is fine, but **don't** route proxied video (MediaFlow/StremThru) through Cloudflare's orange cloud.

## Decision
- **Host: Hetzner Cloud CX23 (x86), EU region.** Turn on Hetzner backups and also send nightly off-site dumps.
- If Torrentio returns 403, send only `*.strem.fun` through `ADDON_PROXY`: either a residential exit over Tailscale, or gluetun.
- Runner-up: a home server with Cloudflare Tunnel. Its residential IP avoids the blocks, but you depend on your home uptime.

Sources: github.com/Viren070/AIOStreams, docs.aiostreams.viren070.me, github.com/cedya77/aiometadata, docs.hetzner.com price adjustment, fly.io/pricing-update, infoq.com (Oracle free tier, 2026-07), cloudflare.com service-specific terms.
