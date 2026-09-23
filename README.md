# selfhosted-aio

A self-hosted AIOStreams + AIOMetadata stack for a small group of people, plus a plan for **AIO Manager**, a web app that manages each person's manifests.

## Contents

| Path | What it is |
|---|---|
| `docs/01-research.md` | Checked facts on both addons: images, env vars, APIs, gotchas, hosting comparison |
| `docs/02-hosting.md` | Choice of hosting provider, DNS, first deploy step by step, updates, backups, restore, monitoring, costs |
| `docs/03-management-ui.md` | AIO Manager design: data model, how it talks to both addons, sync and drift detection, wireframes, build phases |
| `deploy/` | Docker Compose stack (Caddy, AIOStreams, AIOMetadata, Redis 8, Postgres 17, aio-manager), Caddyfile, `.env.example`, bootstrap/backup/restore/update scripts |

## Decisions

- **Host:** Hetzner Cloud CX23, EU region, about €5.49/mo, with Hetzner backups plus nightly restic backups to a Storage Box. The runner-up is a home server behind Cloudflare Tunnel.
- **Subdomains:** `streams.<domain>` (AIOStreams), `meta.<domain>` (AIOMetadata), `manage.<domain>` (AIO Manager). Caddy handles HTTPS.
- **Managing many people:** both addons already store each config server-side under a UUID and a password.
  - AIO Manager creates and updates those configs through the addons' APIs, starting from shared templates and applying per-person overrides and secrets.
  - It stores the credentials encrypted with `MANAGER_KEY`.
  - For each person it gives a share page with install links and a QR code.
- **aio-manager does not exist yet.** The compose service points at a placeholder image until it is built (see the build plan in `docs/03-management-ui.md`).

## Quick start

See `docs/02-hosting.md`, section 3. Short version:

```
# fresh Ubuntu 24.04 on Hetzner
sudo bash deploy/scripts/bootstrap.sh
cp deploy/.env.example deploy/.env   # fill in the secrets; SECRET_KEY can never change
# To try the stack before aio-manager exists, comment out its service
# (and its Caddy site) first; otherwise the pull fails on the placeholder image.
docker compose -f deploy/compose.yaml up -d
```
