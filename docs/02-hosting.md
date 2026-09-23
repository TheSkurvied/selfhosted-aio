# Hosting and deployment

This is how we run AIOStreams, AIOMetadata and aio-manager on one small VPS. The facts behind it are in [01-research.md](01-research.md). The files are in [`deploy/`](../deploy):

| File | Purpose |
|---|---|
| `deploy/compose.yaml` | Caddy, AIOStreams, AIOMetadata, Redis 8, Postgres 17, aio-manager (and gluetun, commented out) |
| `deploy/Caddyfile` | HTTPS for `streams.`, `meta.` and `manage.<DOMAIN>`, security headers, dashboard guard |
| `deploy/.env.example` | Every variable, with comments and the commands that generate secrets |
| `deploy/postgres-init/10-create-databases.sh` | Creates one role and one database per app |
| `deploy/scripts/bootstrap.sh` | Sets up a fresh Ubuntu 24.04 server |
| `deploy/scripts/backup.sh` | Nightly pg_dump, data tarball and restic push |
| `deploy/scripts/restore.sh` | Lists snapshots, runs restore tests, restores config or everything |
| `deploy/scripts/update.sh` | Takes a backup, pulls images and recreates containers, then checks health |

## 1. Where to host

**Choice: Hetzner Cloud CX23 (x86, 2 vCPU, 4 GB RAM, 40 GB SSD) in an EU location (Falkenstein, Nuremberg or Helsinki), at €5.49/mo.**

Why:
- **Cheapest host that gives decent specs and a clean IP.** The whole stack idles at about 1 to 1.5 GB of RAM: two Node apps, Postgres, Redis and Caddy. The 20 TB of egress is far more than we need, because most traffic is small JSON and video normally goes straight from the debrid CDN to the player.
- **IP reputation is fine for most upstreams.** Hetzner's datacenter ranges can still get a 403 from Torrentio or strem.fun (see section 6), but they are not blocked outright the way Oracle is.
- **Plain Docker Compose on a VM.** PaaS hosts (Fly.io, Railway, Render) cost $25–60+ for the same thing and do not run Compose.
- **Snapshots and backups are built in.** The backups option adds 20% to the server price. The Storage Box sits in the same console and is our off-site restic target.

**Runner-up: a home server with Cloudflare Tunnel.**
- Its residential IP avoids the Torrentio/Cloudflare 403 entirely, and there is no monthly bill.
- The downsides: it depends on your home uptime, power and upload speed. Cloudflare's terms also forbid sending video through the tunnel, so you cannot use the AIOStreams built-in stream proxy, MediaFlow or StremThru proxying through it. JSON-only use is fine.
- To go this way, drop the `ports:` from `caddy`, add a `cloudflared` service on the `edge` network, and point the tunnel at `http://aiostreams:3000` and the other services. You can also keep Caddy and point the tunnel at `https://caddy:443`.

**Avoid:**
- **Oracle Free Tier.** Its limits were halved on 2026-08-18, account terminations have been reported, and Torrentio names it as blocked.
- **Contabo.** Cheap, but poor IP reputation and noisy neighbours.
- **DigitalOcean and Vultr at this spec.** $20–24/mo for no benefit.
- **Fly.io, Railway and Render.** Expensive, and they do not run Compose.
- **Cloudflare orange-cloud proxying for video.** It breaks Cloudflare's terms, and long streams get cut.

ARM (CAX11, €5.99) also works, since both images are published for amd64 and arm64. But it costs more than CX23 and gains nothing here.

## 2. DNS

Create these records at your DNS provider. Replace `example.com` with your `DOMAIN` and use the server's IPs:

| Name | Type | Value |
|---|---|---|
| `streams.example.com` | A | server IPv4 |
| `meta.example.com` | A | server IPv4 |
| `manage.example.com` | A | server IPv4 |
| (same three) | AAAA | server IPv6 (optional; Hetzner gives every server a /64) |

**If you use Cloudflare DNS, set all three to "DNS only" (grey cloud).**
- **`streams.` must be grey** as soon as anything proxies video through AIOStreams (built-in proxy, MediaFlow, StremThru). Cloudflare's service terms forbid serving video through the orange-cloud CDN, and a video stream through Cloudflare also hits upload/timeout limits.
- **Grey also keeps Caddy's ACME HTTP-01 challenge simple,** and lets both apps see real client IPs for rate limiting (`USER_CREATE_RATE_LIMIT_*` in AIOStreams, sign-in limits in AIOMetadata).
- **Orange cloud on `meta.` or `manage.` does work (JSON and images),** but then Caddy sees Cloudflare IPs. You would have to add `trusted_proxies cloudflare` (needs the caddy-cloudflare-ip module) or accept that rate limits apply per Cloudflare edge. It is not worth it on this setup.
- **Use a low TTL (300 s) during the first deploy.** You can raise it later.

Check the records before starting Caddy. Otherwise Let's Encrypt rate-limits you after repeated failures:

```bash
dig +short streams.example.com meta.example.com manage.example.com
```

## 3. First deploy, step by step

1. **Create the server** in the Hetzner Cloud Console:
   - Type: CX23, EU location, Ubuntu 24.04.
   - Add your SSH key.
   - Tick **Backups** (+20%).
   - Create a **Cloud Firewall** that allows inbound 22/tcp, 80/tcp, 443/tcp and 443/udp, and attach it to the server. This is a second layer on top of ufw. It matters because Docker-published ports bypass ufw.
2. **Point DNS** at the server (section 2).
3. **Bootstrap the OS** (as root, once):
   ```bash
   scp deploy/scripts/bootstrap.sh root@<ip>:
   ssh root@<ip> 'bash bootstrap.sh aio'
   ```
   The script:
   - installs Docker and the compose plugin, ufw (22/80/443), fail2ban, unattended-upgrades, restic and a 2 GB swap file;
   - creates the user `aio` with root's SSH keys, then turns off root and password SSH login;
   - creates `/opt/aio` and the nightly backup cron entry.

   **Before closing the root session, confirm `ssh aio@<ip>` works from a new terminal.**
4. **Get the code onto the server:**
   ```bash
   ssh aio@<ip>
   git clone <this repo> /opt/aio && cd /opt/aio/deploy
   cp .env.example .env && chmod 600 .env
   ```
5. **Fill in `.env`.** The generation one-liners are at the top of the file. Set `DOMAIN`, `ACME_EMAIL`, every password and secret, `AIOSTREAMS_AUTH` and the `BUILT_IN_*` keys you have.
   - **`AIOSTREAMS_SECRET_KEY` can never change.** It encrypts every stored AIOStreams config. Copy it, and `RESTIC_PASSWORD`, into your password manager now.
   - **Use hex passwords (`openssl rand -hex 24`).** They go into connection URIs, and hex never needs URL escaping.
6. **Validate and start:**
   ```bash
   docker compose config -q          # fails loudly if a required variable is missing
   docker compose pull
   docker compose up -d
   docker compose ps                 # all services should become "healthy"
   docker compose logs -f caddy      # watch certificates being issued
   ```
   On first start, Postgres runs `postgres-init/10-create-databases.sh`, which creates the `aiostreams`, `aiometadata` and `manager` roles and databases. This happens only when `data/postgres` is empty.
7. **Smoke test** from your laptop:
   ```bash
   curl -fsS https://streams.example.com/api/v1/health
   curl -fsS https://meta.example.com/health/ready
   curl -fsSI https://manage.example.com/
   ```
8. **Configure the apps:**
   - **AIOStreams:** log in to `https://streams.<DOMAIN>/dashboard` with `AIOSTREAMS_AUTH`. Set the runtime settings in Settings:
     - addon timeouts of about 5000 ms (`DEFAULT_TIMEOUT`);
     - the proxy, if needed (section 6);
     - branding.

     Settings made in the dashboard live in Postgres and are backed up. Settings pinned in env are locked in the UI.
   - **AIOMetadata:** open `https://meta.<DOMAIN>/dashboard` with `AIOMETADATA_ADMIN_KEY`.
   - **aio-manager:** open `https://manage.<DOMAIN>`.
9. **Set up off-site backups** (section 4.2), then run `sudo /opt/aio/deploy/scripts/backup.sh` once by hand and check that it finishes.
10. **Optional: lock down the dashboards.** Set `ADMIN_ALLOW_CIDRS` in `.env` to your home IP or Tailscale range (`100.64.0.0/10`), then `docker compose up -d caddy`. The trade-offs are in section 5.

## 4. Day-2 operations

### 4.1 Updates

```bash
cd /opt/aio/deploy && ./scripts/update.sh          # all services
./scripts/update.sh aiostreams                      # one service
```

- **Tags are pinned to majors:**
  - AIOStreams `v2`, AIOMetadata `3` (never `latest`, because of the stray `v5.0.0` tag);
  - `caddy:2`, `postgres:17`, `redis:8`.

  A pull therefore only brings minor and patch releases within those majors.
- **What `update.sh` does:**
  1. asks whether you have read the changelogs;
  2. takes a local backup (dumps and data tarball in `/var/backups/aio`);
  3. pulls the images and recreates the changed containers;
  4. waits for the healthchecks.
- **Read the changelogs first:**
  - **AIOStreams:** [releases](https://github.com/Viren070/AIOStreams/releases) and the [migration guides](https://docs.aiostreams.viren070.me/migrations/). For example, v2.30 moved most settings from env to the dashboard. Database migrations run on start and only go forward.
  - **AIOMetadata:** [releases](https://github.com/cedya77/aiometadata/releases). Watch for env var renames and new Redis requirements.
- **Rollback:**
  1. Set `AIOSTREAMS_TAG` or `AIOMETADATA_TAG` to the previous exact version (for example `v2.34.1` or `3.0.0`).
  2. If a DB migration ran, `./scripts/restore.sh full-local /var/backups/aio`.
  3. `docker compose up -d`.
- **OS:** unattended-upgrades installs security updates daily without rebooting. Check for `/var/run/reboot-required` about once a month and reboot in a quiet hour. The containers come back on their own (`restart: unless-stopped`).
- **Postgres 17 to 18 is a major upgrade.** It needs a dump and restore into a new data directory. Do not just bump the tag.

### 4.2 Backups

Two layers:

1. **Hetzner Cloud Backups:** daily whole-disk images, 7 kept. This is the quick way back if the server breaks, but it lives with the same provider and account.
2. **`scripts/backup.sh` via restic:** runs nightly at 03:30 (`/etc/cron.d/aio-backup`, as root) and sends off-site, encrypted, versioned backups. Each run:
   - dumps each database with `pg_dump -Fc` and checks that the dump can be read back;
   - archives `data/aiostreams`, `data/aiometadata` and `data/caddy`, minus the caches;
   - archives `.env`, `Caddyfile` and `compose.yaml`;
   - keeps 7 daily, 4 weekly and 6 monthly snapshots, and reads 1/7 of the repository data each night, so the whole repository is verified weekly.
   - Redis is not backed up: it is a cache and refills itself.

**Target, option A: Hetzner Storage Box.** BX11, 1 TB, about €3–4/mo. Use a different location from the server.

```bash
# on the server, as root
ssh-keygen -t ed25519 -N '' -f /root/.ssh/storagebox
ssh-copy-id -p 23 -s -i /root/.ssh/storagebox.pub uXXXXXX@uXXXXXX.your-storagebox.de
cat >>/root/.ssh/config <<'EOF'
Host storagebox
  HostName uXXXXXX.your-storagebox.de
  User uXXXXXX
  Port 23
  IdentityFile /root/.ssh/storagebox
EOF
ssh storagebox ls   # accept the host key once
```

Then set `RESTIC_REPOSITORY=sftp:storagebox:restic-aio` in `.env`. The first `backup.sh` run initialises the repository. In the Storage Box settings, turn on SSH support and turn off everything you do not use (Samba, WebDAV, external reachability you do not need).

**Target, option B: S3-compatible bucket** (Backblaze B2, Hetzner Object Storage, Wasabi). Set these in `.env`:
- `RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>/aio`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Use a key scoped to that one bucket.

**Store these outside the server:** `RESTIC_PASSWORD`, `RESTIC_REPOSITORY`, the Storage Box credentials and `AIOSTREAMS_SECRET_KEY`. Without them the backups cannot be restored. Note that `.env` is inside the (encrypted) backup, which is why you need the restic password to get it back.

### 4.3 Restore test (monthly)

```bash
sudo /opt/aio/deploy/scripts/restore.sh list
sudo /opt/aio/deploy/scripts/restore.sh verify          # latest snapshot
```

`verify`:
- restores the snapshot to a temporary directory;
- loads every dump into a throwaway `postgres:17` container and prints the table count for each database;
- checks that both tarballs can be read and that `.env` is in the config tarball.

It touches nothing live. Put it on a calendar.

**Full disaster recovery** (new server):
1. Run `bootstrap.sh`, then clone the repo to `/opt/aio`.
2. `export RESTIC_REPOSITORY=... RESTIC_PASSWORD=...`, and set up the Storage Box SSH key again.
3. `scripts/restore.sh config`, then `cp restored-config/.env .env`.
4. `docker compose up -d postgres`.
5. `scripts/restore.sh full`.
6. Point DNS at the new IP.

Because `SECRET_KEY` comes back with `.env`, every existing AIOStreams manifest URL keeps working once DNS has moved.

### 4.4 Monitoring

**Minimum: an external uptime check.** It has to run from outside the box, or it cannot tell you the box is down. Check these URLs:

| URL | What it checks |
|---|---|
| `https://streams.<DOMAIN>/api/v1/health` | AIOStreams, including the database |
| `https://meta.<DOMAIN>/health/ready` | AIOMetadata readiness |
| `https://manage.<DOMAIN>/healthz` | aio-manager (assumes the app serves this path) |

Also watch certificate expiry on all three hosts. Caddy renews at about 30 days left, so an alert at 14 days means renewal is broken.

Options:
- **Uptime Kuma** on a home server or Raspberry Pi. Most independent choice.
- **A free hosted pinger.**
- **Uptime Kuma as an extra service on this box.** Easiest, but it only catches app failures, not whole-server failures.

For Uptime Kuma on this box, add `louislam/uptime-kuma:2` on the `edge` network with a `./data/uptime-kuma:/app/data` volume, and a `status.{$DOMAIN}` block in the Caddyfile that imports `admin_guard`.

Other things to look at:
- `docker compose ps`: every service should be healthy.
- `docker stats --no-stream`: memory. The CX23 has 4 GB. Redis is capped at `AIOMETADATA_REDIS_MAXMEMORY` (768 MB), and the containers have memory limits.
- `df -h`: the AIOMetadata poster cache, if enabled, defaults to up to 10 GB. Set `POSTER_CACHE_MAX_SIZE` lower on a 40 GB disk.
- `tail /var/log/aio-backup.log`: last night's backup.
- The Hetzner Console graphs, plus an email alert for CPU above 90% sustained.

## 5. Protecting the dashboards

The addon routes (`/stremio/...`, manifests, catalogs, meta, streams, images) **must stay public**. Stremio clients send no cookies or credentials. The configure pages and the user APIs (`/api/v1/user`, `/api/config/*`) have to stay reachable too, for anyone who configures an addon.

The Caddyfile sends only the admin surfaces through the `(admin_guard)` snippet:
- AIOStreams: `/dashboard*` and `/api/v1/dashboard*`
- AIOMetadata: `/dashboard*`, `/api/dashboard*` and `/api/admin/*`

Pick one guard:

| Option | Pros | Cons |
|---|---|---|
| **A. IP allowlist** (`ADMIN_ALLOW_CIDRS`, default in the Caddyfile) | Invisible to you, no second password. Scanners get a 403 before reaching the app login. Pairs well with Tailscale (`100.64.0.0/10`) | You are locked out from other networks until you edit `.env` and restart Caddy. A home IP that changes needs updating |
| **B. Caddy basic auth** | Works from anywhere | Two logins. A cached basic-auth prompt can confuse the apps' own sign-in and sign-out. One more password to manage |
| **Neither** (default `0.0.0.0/0 ::/0`) | Simplest | Only the apps' own auth protects them (`AIOSTREAMS_AUTH`; the `ADMIN_KEY` or identity provider for AIOMetadata) |

aio-manager calls both addons over the Docker network (`http://aiostreams:3000`, `http://aiometadata:3232`), so neither guard affects it.

Related app settings:
- AIOStreams:
  - `AIOSTREAMS_AUTH_REQUIRED=true` puts the configure page behind a login.
  - It also enforces `CONFIG_ACCESS_KEY`, which is embedded in every config, so **rotating the key breaks all configs**.
- AIOMetadata:
  - `ADDON_PASSWORD` is needed to create configs.
  - `USER_ALIASES_ENABLED` stays `false`.
  - `POSTER_PROXY_ALLOW_PRIVATE` stays `false` to block SSRF.

## 6. Torrentio / strem.fun 403 mitigation

Torrentio and the other `*.strem.fun` addons sit behind Cloudflare challenges that return 403 to many datacenter IPs. Test from the server itself:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://torrentio.strem.fun/manifest.json
```

**200: nothing to do.** **403: route only strem.fun through a proxy.** Everything else stays direct, to keep latency low and the proxy lightly loaded.

In the AIOStreams dashboard (Settings, HTTP), or env-pinned by uncommenting the lines in `compose.yaml`:

```
ADDON_PROXY=http://<proxy>:<port>
ADDON_PROXY_CONFIG=*:false,*.strem.fun:true
```

Proxy options, best first:

1. **Residential exit over Tailscale.**
   - Install Tailscale on the server and on a home device.
   - Run a small HTTP proxy on the home device, bound to its tailnet IP (tinyproxy or `gost`).
   - Set `ADDON_PROXY=http://100.x.y.z:8888`. Containers reach the tailnet through the host.
   - Residential IPs pass Cloudflare reliably, and the traffic is tiny (JSON only).
2. **gluetun** (commented out in `compose.yaml`).
   - A commercial VPN with gluetun's built-in HTTP proxy on `:8888`, so `ADDON_PROXY=http://gluetun:8888`.
   - Easy, but VPN exit IPs are often challenged too, so test a few server countries.
3. **Different scrapers.** Use the AIOStreams built-in addons or other torrent sources, which do not sit behind the same challenge, and drop Torrentio.

**Separate issue: debrid IP limits.** Some debrid providers allow a stream from one IP only. If playback fails because the server IP and the player IP differ, proxy the streams through the AIOStreams built-in proxy, MediaFlow or StremThru. That puts video on this server's egress, which is well within 20 TB. It also means `streams.` **must** be grey-cloud if you use Cloudflare.

## 7. Jikan shutdown (anime catalogs)

**The public Jikan API (`api.jikan.moe`) shuts down on 2026-10-01.** After that date, AIOMetadata's MAL and anime catalogs and metadata stop working unless `JIKAN_API_BASE` points at a self-hosted Jikan.

- AIOMetadata ships a guide at `docs/self-hosted-jikan.md` in its repo. It runs `jikanme/jikan-rest` plus MongoDB, Redis 6 and Typesense.
- That adds roughly 1–1.5 GB of RAM, which is tight next to this stack on a CX23. Pick one:
  - upgrade to CX33 (8 GB);
  - run Jikan on a second small server or at home, reached over Tailscale;
  - skip anime catalogs.
- To run it on this box, add the Jikan services to the `edge` network (Mongo and Typesense can go on `backend`), then set `JIKAN_API_BASE=http://jikan_rest:8080/v4` in `.env` and run `docker compose up -d aiometadata`.
- Keep `MAL_PAGE_SIZE` no larger than the instance's `MAX_RESULTS_PER_PAGE`.

## 8. Costs

Prices checked September 2026. VAT treatment varies by country and account type.

| Item | Monthly | Notes |
|---|---|---|
| Hetzner CX23 (2 vCPU, 4 GB, 40 GB, 20 TB egress) | €5.49 | From the research. Check whether the primary IPv4 (about €0.50) is billed on top in your account |
| Hetzner Cloud Backups | ~€1.10 | 20% of the server price |
| Hetzner Storage Box BX11 (1 TB) | ~€3–4 | Estimate, not checked. Or use S3/B2 at a few cents for a few GB |
| Domain | ~€1 | About €10–15 a year |
| **Total** | **~€11/mo** | **~€7/mo if you skip Cloud Backups and use pay-per-GB object storage** |
| Optional: CX33 instead of CX23 (for self-hosted Jikan) | about +€3–4 | Estimate, not checked |
| Optional: VPN for gluetun | €3–5 | Only if Torrentio returns 403 and no residential exit is available |
