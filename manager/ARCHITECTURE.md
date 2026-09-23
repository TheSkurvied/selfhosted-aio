# AIO Manager: architecture and build contract

This file is the shared contract for everyone building the app. The product spec is `../docs/03-management-ui.md`; read it first. Where this file and the spec disagree, **this file wins**.

## Stack

- SvelteKit 2 + Svelte 5 (runes), TypeScript, `@sveltejs/adapter-node`.
- Drizzle ORM on Postgres through `postgres` (postgres.js).
- Package manager: **pnpm**. Do not use npm; it crashes in this repo.
- Tests: vitest for unit and integration, Playwright for e2e.
- Deps already installed: `@oslojs/otp`, `@oslojs/encoding`, `@oslojs/crypto`, `arctic`, `@node-rs/argon2`, `qrcode`, `zod`, `tsx`.
  - Before adding a dependency, check whether a few lines of code would do.
  - If you add one, run `pnpm add` on its own. Never run two `pnpm add` commands at the same time.

## Runtime env (all read in `src/lib/server/env.ts`, validated with zod)

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres URL. |
| `MANAGER_KEY` | yes | 64 hex characters (32 bytes). The AES-256-GCM key. |
| `PORT` | no | adapter-node reads it; it is 8080 in compose. |
| `PUBLIC_URL` | yes | The manager's own URL, e.g. `https://manage.example.com`. Also set `ORIGIN` to the same value for the adapter-node CSRF check; the Dockerfile sets `ORIGIN=$PUBLIC_URL` in its entrypoint. |
| `AIOSTREAMS_INTERNAL_URL` | yes | e.g. `http://aiostreams:3000` |
| `AIOSTREAMS_PUBLIC_URL` | yes | Used to build the manifest URLs that people get. |
| `AIOSTREAMS_USERNAME` | no | Account used when `AIOSTREAMS_AUTH_REQUIRED=true` upstream. |
| `AIOSTREAMS_PASSWORD` | no | Password for `AIOSTREAMS_USERNAME`. |
| `AIOMETADATA_INTERNAL_URL` | yes | e.g. `http://aiometadata:3232` |
| `AIOMETADATA_PUBLIC_URL` | yes | Used to build the manifest URLs that people get. |
| `AIOMETADATA_ADMIN_KEY` | yes | Sent as `x-admin-key`. |
| `AIOMETADATA_ADDON_PASSWORD` | no | Sent as `addonPassword` on save, load and update. |
| `OIDC_ISSUER` | no | All four `OIDC_*`/`ADMIN_EMAILS` variables together turn on OIDC login. |
| `OIDC_CLIENT_ID` | no | See `OIDC_ISSUER`. |
| `OIDC_CLIENT_SECRET` | no | See `OIDC_ISSUER`. |
| `ADMIN_EMAILS` | no | Comma separated. |
| `NTFY_URL` | no | e.g. `https://ntfy.sh/my-topic`. Drift and missing notifications are POSTed here. |
| `CHECK_INTERVAL_HOURS` | no | Default 6. Set to 0 to disable scheduled checks. |
| `LOG_LEVEL` | no | Default `info`. |

**Instances come from env only; there is no editing in the UI.**
- At boot the app upserts two rows into `instances`, one for each kind.
- The Settings page shows them read-only, with the secrets masked.

## Directory ownership

Each agent owns certain paths. Do not edit files you do not own. If you need a change in someone else's file, write it down in your final report.

```
src/lib/server/env.ts, db/*, crypto.ts, auth/*, audit.ts, log.ts   FOUNDATION
src/hooks.server.ts, src/routes/healthz, src/routes/(auth)/**/+page.server.ts,
  src/routes/auth/**  (OIDC endpoints, logout), drizzle/ (migrations),
  Dockerfile, .dockerignore                                          FOUNDATION
src/lib/ui/**, src/lib/icons/**, src/app.html, src/app.css,
  src/routes/+layout.svelte, src/routes/(app)/+layout.svelte,
  src/routes/(auth)/**/+page.svelte, src/routes/+error.svelte        DESIGN
src/lib/server/adapters/**, sync/**, services/**, jobs/**,
  src/routes/api/**, tests/integration/**                             ENGINE
src/routes/(app)/**  (every page except (app)/+layout.svelte),
  src/routes/s/**                                                     PAGES
scripts/upstream/**, tests/mocks/**                                   UPSTREAM
```

## Shared server modules (FOUNDATION provides these)

```ts
// $lib/server/env.ts
export const env: { DATABASE_URL: string; MANAGER_KEY: string; PUBLIC_URL: string; ...; oidcEnabled: boolean; adminEmails: string[] };

// $lib/server/db/index.ts
export const db;                 // drizzle instance, schema attached
export * as t from './schema';   // tables

// $lib/server/crypto.ts
seal(plain: string, aad: string): string      // 'v1:' + b64url nonce + ':' + ct + ':' + tag
open(sealed: string, aad: string): string
aadFor(table: string, column: string, rowId: string): string   // `${table}.${column}.${rowId}`
sha256Hex(s: string): string
randomToken(bytes = 32): string               // base64url
canonicalJson(v: unknown): string             // keys sorted recursively, no whitespace
hint(secret: string): string                  // '••••' + last 4

// $lib/server/audit.ts
audit(e: { actor: string; action: string; targetType?: string; targetId?: string;
           summary: string; diffPaths?: string[]; ip?: string }): Promise<void>

// $lib/server/log.ts
log.info/warn/error(msg, fields?)   // JSON lines; redacts keys matching /pass|key|token|secret|credential/i
```

- IDs are text UUIDs generated with `crypto.randomUUID()`. The row id is created before sealing, so it can go into the AAD.
- Timestamps are `timestamp with time zone`.
- Migrations live in `drizzle/`. They are generated with `pnpm db:generate` and applied at boot by `$lib/server/db/migrate.ts`, which uses the drizzle-orm migrator and is called from `hooks.server.ts` `init`.

`event.locals` holds `{ admin: { id, email } | null, sessionId: string | null }`.
- `hooks.server.ts` sends every non-public route to `/login` when `locals.admin` is null.
- Public routes are `/login`, `/setup`, `/login/totp`, `/auth/*`, `/s/*`, `/healthz`, and static assets.
- `/setup` exists only while there are no admins.
- `/api/**` routes answer 401 JSON instead of redirecting.

## Auth form contract (FOUNDATION server, DESIGN svelte)

- `/setup` has **no `default` action**, because SvelteKit does not allow one next to named actions.
  - The first form posts to `?/setup` with `email`, `password` and `password2`. It returns `{ step: 'totp', totpUri, totpSecret, qrSvg }`.
  - The second form posts to `?/confirm` with `code`. It returns `{ recoveryCodes: string[] }`.
  - Load data is `{ done: boolean }`.
- `/login`: action `default` with `email` and `password`.
  - On success it redirects to `/login/totp`. `form?.error` is a string.
  - Page data is `{ oidcEnabled, ssoError: string | null }`.
  - "Continue with SSO" is a plain link to `/auth/oidc`, because the CSP has `form-action 'self'`.
- `/login/totp`: action `default`, field `code`, which takes a 6-digit code or a recovery code.
- Logout: `<form method="POST" action="/auth/logout">`.

## Engine service API (ENGINE implements, PAGES consumes)

All of these are server-only, exported from `$lib/server/services/index.ts`. All mutating functions take `actor: string` (the admin id) and write to the audit log. They throw `ServiceError(message, status)` on bad input.

```ts
type InstanceKind = 'aiostreams' | 'aiometadata';
type SyncStatus = 'in_sync' | 'pending' | 'drifted' | 'missing' | 'error' | 'unbound' | 'never_pushed';

// health
getHealth(): Promise<Array<{ kind: InstanceKind; publicUrl: string; ok: boolean; version?: string;
  checks: Array<{ endpoint: string; ok: boolean; latencyMs: number; detail?: string }> }>>

// people
listPeople(q?: { search?: string; tag?: string }): Promise<Array<PersonRow>>
  // PersonRow = { id, displayName, tags: string[], disabled, notes,
  //   bindings: Record<InstanceKind, { templateName: string; version: number; pinned: boolean; status: SyncStatus } | null> }
getPerson(id): Promise<PersonDetail>
  // PersonDetail = PersonRow + { createdAt, bindings: Record<InstanceKind, BindingDetail | null>,
  //   secrets: Array<{ name, scope: 'person'|'shared', hint, updatedAt }>, requiredSecrets: Array<{ name; satisfiedBy: 'person'|'shared'|null }>,
  //   shareTokens: Array<{ id, createdAt, expiresAt, maxViews, views, revokedAt, url?: string /* only right after creation */ }>,
  //   history: AuditRow[] }
  // BindingDetail = { id, templateId, templateName, pinnedVersionId, currentVersion, renderedVersion,
  //   overrides: object, status: SyncStatus, lastError?: string, account?: { id, remoteUuid, state, lastPushAt, lastCheckAt, createdAt },
  //   manifestUrl?: string }
createPerson(actor, { displayName, notes?, tags? }): Promise<{ id }>
updatePerson(actor, id, patch: { displayName?, notes?, tags?, disabled? }): Promise<void>
deletePerson(actor, id, { deleteUpstream: boolean }): Promise<void>
setBinding(actor, personId, kind, { templateId, pinnedVersionId: string | null, overrides: object }): Promise<void>
removeBinding(actor, personId, kind, { deleteUpstream: boolean }): Promise<void>
renderPreview(personId, kind): Promise<{ masked: object; desiredHash: string; missingSecrets: string[] }>
diffRemote(personId, kind): Promise<{ changes: Array<{ path: string; kind: 'added'|'removed'|'changed' }>; maskedRemote: object; maskedDesired: object }>

// actions (all enqueue jobs and return job ids; they are not run inline)
pushBinding(actor, personId, kind): Promise<{ jobId }>
checkBinding(actor, personId, kind): Promise<{ jobId }>
rotateBinding(actor, personId, kind): Promise<{ jobId }>
adoptRemote(actor, personId, kind): Promise<void>   // remote -> overrides (sync, not queued)
revokePerson(actor, personId): Promise<{ jobIds: string[] }>
bulk(actor, action: 'push'|'check', personIds: string[]): Promise<{ jobIds: string[] }>
pushAllPending(actor): Promise<{ jobIds: string[] }>
checkAll(actor): Promise<{ jobIds: string[] }>
syncSummary(): Promise<Record<SyncStatus, number>>

// templates
listTemplates(): Promise<Array<{ id, name, kind, description, currentVersion: number, usedBy: number, updatedAt }>>
getTemplate(id): Promise<{ id, name, kind, description, versions: Array<{ id, version, note, createdAt, createdBy }>,
  current: { id, version, body: object, requiredSecrets: string[] },
  usage: Array<{ personId, displayName, pinned: boolean, version: number }>,
  secretCoverage: Array<{ name, shared: boolean, peopleWith: number, peopleNeeding: number }> }>
getTemplateVersion(templateId, versionId): Promise<{ id, version, body: object, requiredSecrets: string[], note }>
createTemplate(actor, { name, kind, description?, body: object, note? }): Promise<{ id }>
updateTemplateMeta(actor, id, { name?, description? }): Promise<void>
deleteTemplate(actor, id): Promise<void>   // refuses while any binding uses it
saveTemplateVersion(actor, id, { body: object, note?: string }): Promise<{ versionId, version }>
extractSecrets(body: object): { body: object; found: Array<{ path: string; suggestedName: string; hint: string; value: string }> }
  // pure; the page shows the found items and calls applyExtraction
applyExtraction(body: object, picks: Array<{ path: string; name: string }>): object
dryRunTemplate(id): Promise<Array<{ personId, displayName, kind, willChange: boolean, missingSecrets: string[] }>>
pushTemplate(actor, id): Promise<{ jobIds: string[] }>
validateTemplateBody(kind, body): { ok: boolean; errors: string[] }

// secrets
listSharedSecrets(): Promise<Array<{ name, hint, updatedAt, usedByTemplates: string[], peopleRelying: number }>>
setSecret(actor, scope: 'shared'|'person', personId: string | null, name: string, value: string): Promise<void>
deleteSecret(actor, scope, personId, name): Promise<void>

// share tokens
createShareToken(actor, personId, { expiresInDays?: number | null; maxViews?: number | null }): Promise<{ id, url }>
revokeShareToken(actor, tokenId): Promise<void>
resolveShareToken(token: string): Promise<null | { displayName: string; expiresAt: Date | null;
  links: Array<{ kind: InstanceKind; label: string; manifestUrl: string; stremioUrl: string; qrSvg: string }> }>
  // counts a view; returns null if the token is unknown, expired, revoked, over its view limit, or the person is disabled

// import
importAiostreams(actor, { uuid, password, personId?: string, displayName?: string, templateId?: string }): Promise<{ personId }>
listAiometadataCandidates(): Promise<Array<{ uuid, createdAt, lastUpdated, known: boolean, personName?: string }>>
importAiometadata(actor, { uuid, personId?: string, displayName?: string, templateId?: string }): Promise<{ personId }>
orphanReport(): Promise<Array<{ kind: InstanceKind; uuid: string; createdAt?: string }>>

// jobs + audit
listJobs(q?: { status?: string; limit?: number }): Promise<Array<JobRow>>
  // JobRow = { id, type, status: 'queued'|'running'|'done'|'failed', personName?, kind?, attempts, error?, createdAt, finishedAt, progress?: string }
subscribeJobs(cb: (job: JobRow) => void): () => void    // in-process event bus, used by the SSE route
listAudit(q?: { personId?: string; action?: string; limit?: number; before?: string }): Promise<Array<AuditRow>>
  // AuditRow = { id, at, actorEmail: string /* 'system' for the system */, action, targetType, targetId, summary, diffPaths: string[] }
getSettings(): Promise<{ instances: Array<{ kind, internalUrl, publicUrl, authConfigured: boolean }>, oidcEnabled: boolean,
  admins: Array<{ id, email, totp: boolean, oidc: boolean, createdAt }>, keyFingerprint: string, checkIntervalHours: number, ntfy: boolean }>
```

- The job runner starts from `hooks.server.ts` `init` by calling `startJobRunner()` and `startScheduler()`, both exported from `$lib/server/jobs`. FOUNDATION adds the calls with guarded dynamic imports; ENGINE provides the functions.
- API routes under `/api/**` wrap these services as JSON, following section 10 of the spec.
- `GET /api/jobs/stream` is SSE.
- Pages use form actions and load functions that call the services directly. They do not go through `/api`.

## Design system: Notion style (DESIGN)

The reference is Notion's app UI: calm, neutral, content-first.
- **No emojis anywhere.** Where Notion would use an emoji as a page icon, use monochrome line SVG icons (stroke 1.5, 16/18/20px).

- **Tokens** go in `src/app.css` as CSS custom properties on `:root`.
  - Dark values go under `@media (prefers-color-scheme: dark)` and `[data-theme=dark]`.
  - A theme toggle in the sidebar sets `data-theme`; the choice is stored in localStorage and the OS setting is the default.

| Token | Light | Dark |
|---|---|---|
| Text | `#37352F` | `rgba(255,255,255,0.81)` |
| Secondary text | `rgba(55,53,47,0.65)` | |
| Tertiary text | `rgba(55,53,47,0.45)` | |
| Page background | `#FFFFFF` | `#191919` |
| Sidebar | `#F7F7F5` | `#202020` |
| Hover | `rgba(55,53,47,0.06)` | |
| Pressed | `rgba(55,53,47,0.12)` | |
| Divider/border | `rgba(55,53,47,0.09)` | |
| Input border | `rgba(55,53,47,0.16)` | |
| Accent blue | `#2383E2` | |
| Danger | `#EB5757` | |

- **Tag colors** are background/text pairs:

| Color | Background | Text |
|---|---|---|
| gray | `#E3E2E0` | `#32302C` |
| brown | `#EEE0DA` | `#442A1E` |
| orange | `#FADEC9` | `#49290E` |
| yellow | `#FDECC8` | `#402C1B` |
| green | `#DBEDDB` | `#1C3829` |
| blue | `#D3E5EF` | `#183347` |
| purple | `#E8DEEE` | `#412454` |
| pink | `#F5E0E9` | `#4C2337` |
| red | `#FFE2DD` | `#5D1715` |

  Dark mode uses Notion's dark equivalents: muted, low-saturation backgrounds with light text.

- **Status colors:**

| Status | Color |
|---|---|
| in_sync | green |
| pending | yellow |
| drifted | orange |
| missing | red |
| error | red |
| unbound | gray |
| never_pushed | blue |

- **Type:**
  - Font stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`.
  - Mono: `"SFMono-Regular", Menlo, Consolas, monospace`.
  - Body is 16px/1.5. Sidebar and tables are 14px.
  - Page title: 40px, 700, letter-spacing -0.01em.
  - H2 is 24px/600; H3 is 18px/600.
- **Layout:**
  - Left sidebar, 240px wide and collapsible, holds the workspace name ("AIO Manager") at the top.
  - Nav items: Dashboard, People, Templates, Secrets, Jobs, Audit log, Settings. The theme toggle and sign-out sit at the bottom.
  - Top bar: 45px, with breadcrumbs on the left and page actions on the right.
  - Content: max width 900px centered with 96px side padding. Wide pages such as tables use full width with 96px padding, dropping to 16px on mobile.
  - Below 768px the sidebar becomes an overlay.
- **Components** go in `src/lib/ui/`, each a Svelte 5 file:
  - Basics: `Button` (variants default/primary/danger/ghost, sizes sm/md), `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Toggle`, `Tag`, `StatusTag`.
  - Page layout:
    - `PageHeader`: icon, title, description, actions slot.
    - `PropertyList`/`Property`: Notion page properties, with a label column about 160px and a value column.
    - `Callout`: a gray, blue, yellow or red background with an icon.
    - `ToggleBlock`: the Notion toggle list, with a caret.
    - `Divider`, `EmptyState`.
  - Data and editing:
    - `Table`: the Notion database table view, with hairline borders, 14px text, hover rows and a sticky header.
    - `Tabs`: underline style, like Notion database views.
    - `CodeEditor`: a textarea with mono font, line numbers and JSON validation state. No heavy editor dependency.
    - `JsonView`: collapsible tree, read-only.
  - Overlays and feedback:
    - `Modal`: centered, soft shadow `0 0 0 1px rgba(15,15,15,.05), 0 3px 6px rgba(15,15,15,.1), 0 9px 24px rgba(15,15,15,.2)`.
    - `Menu`: the "..." dropdown.
    - `Toast`: bottom center, dark pill.
    - `Tooltip`, `Spinner`, `ProgressBar`, `Kbd`.
  - Navigation: `Breadcrumbs`, `Sidebar`, `SidebarItem`, `CopyButton`, `QrCode` (renders a given SVG string).
- **Motion and detail:**
  - Transitions of 100–150ms on backgrounds.
  - Radius is 4px for controls and 6px for cards and modals.
  - Focus ring: `0 0 0 2px rgba(35,131,226,.35)`.
- **Accessibility:** use real buttons, labels and aria for menus and modals, keep contrast AA, and support keyboard navigation.

## Conventions

- Svelte 5 runes only (`$props`, `$state`, `$derived`). Use snippets, not slots.
- Server-only code lives under `$lib/server`, so it never reaches the client bundle.
- Never return decrypted secrets to the client. The one exception is the upstream manifest URLs shown to admins and on share pages.
- Errors shown in the UI are strings without secret values.
- Run `pnpm check`, `pnpm lint` and `pnpm vitest run` before finishing. Fix your own files.
- Dev DB: `DATABASE_URL` in `.env`. The local Postgres 16 is running on localhost:5432 (user manager/manager; the dbs are `aio_manager` and `aio_manager_test`).
- Do not commit. The orchestrator commits.
