# AIO Manager

A small self-hosted admin app that manages the **AIOStreams** and **AIOMetadata** configs of everyone you share your Stremio setup with. You build templates once, give each person their own overrides and debrid keys, push to both addons, spot configs that were changed somewhere else, and send each person a private install page with a QR code.

Design notes: `ARCHITECTURE.md` (build contract), `../docs/03-management-ui.md` (spec), `src/lib/ui/README.md` (Notion-style design system). Screenshots are in `docs/screenshots/pages/`.

## Features

- **People:** one AIOStreams and one AIOMetadata config per person. Each person gets a template, can be pinned to a version or follow the latest one, and can have JSON merge-patch overrides.
- **Templates:** each save creates a new version.
  - "Extract secrets" turns pasted keys into `{{secret:name}}` placeholders.
  - A dry run shows who would change, and you can then push to everyone.
- **Secrets:** shared secrets, or per-person ones that take priority over shared ones.
  - They are encrypted with AES-256-GCM, bound to their row, and never sent back to the browser.
- **Sync:** each config shows as in sync, pending, drifted, missing or error.
  - A diff against the remote config is shown with secrets masked.
  - You can adopt the remote changes as overrides, or overwrite them.
  - A check runs every 6 hours, and ntfy can alert you on drift.
- **Rotate or revoke** a person's manifest.
- **Import** existing configs. For AIOStreams you need the uuid and password. For AIOMetadata you pick from the admin list, and the config's password is reset.
- **Share pages** at `/s/:token`: Stremio deeplinks, QR codes, and links that can expire or be limited to a number of views.
- **Admin:** local password with TOTP and recovery codes, or OIDC. There is also an audit log, a jobs view with live updates, a health panel, and an orphan report.

## Running it

In production it runs as the `aio-manager` service in `../deploy/compose.yaml`. See `../docs/02-hosting.md`. On first visit, `https://manage.<domain>/setup` creates the admin account.

Env vars are listed in `ARCHITECTURE.md`. Compose passes them in from `../deploy/.env` (with the `MANAGER_` prefix).

Admin tools inside the container:

```
# Lost password or authenticator
docker compose exec aio-manager node build/cli/reset-admin.mjs you@example.com --password --totp
# New MANAGER_KEY (put the new key in .env, recreate the container, then:)
docker compose exec -e OLD_MANAGER_KEY=<old> aio-manager node build/cli/rotate-key.mjs --dry-run
```

## Development

The app needs Node 22, pnpm 10 and Postgres 15 or newer. Use pnpm, not npm.

```
pnpm install
cp .env.example .env          # set DATABASE_URL, TEST_DATABASE_URL, MANAGER_KEY, ...
pnpm dev:mocks                # in-memory AIOStreams/AIOMetadata mocks + vite dev on :5173
pnpm check && pnpm lint
pnpm vitest run               # unit + integration (needs TEST_DATABASE_URL)
pnpm test:e2e                 # Playwright; resets the aio_manager_e2e database
pnpm screenshots              # e2e + capture docs/screenshots/pages
```

Real upstreams for integration runs are covered in `tests/mocks/README.md` (`scripts/upstream/*.sh`, then `RUN_REAL_UPSTREAM=1 pnpm vitest run tests/integration/real-upstream.test.ts`).

- AIOMetadata has been tested end to end against the real service.
- AIOStreams has only been tested against a mock built from its source code, because its build could not run in the sandbox where this app was developed.
