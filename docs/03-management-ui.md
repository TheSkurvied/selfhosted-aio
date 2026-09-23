# Plan: AIO Manager (management UI for AIOStreams + AIOMetadata)

Status: design only, nothing built yet. Written 2026-09-23.

Upstream code was checked at these commits:
- AIOStreams `b3bf75b`. Paths below start with `AIOStreams/`.
- aiometadata `7ef886c`. Paths below start with `aiometadata/`.

Read `01-research.md` first.

## 1. Goals and non-goals

**Goals**
- One place for 1 to 3 admins to create, edit, and remove the AIOStreams and AIOMetadata configs of about 5 to 30 people.
- Templates such as "Family" and "Anime fan" hold the base config. Each person then gets small overrides and their own secrets.
- Push changes to the services, find configs that were changed somewhere else, and re-push to everyone after a template edit.
- Give each person a share page with Stremio install links, a QR code, and an optional link that expires.
- Rotate or revoke a person's manifest. Import configs that already exist. Keep an audit log and a health panel.

**Non-goals**
- Replacing the config editors in either upstream app. Templates are edited as JSON, starting from a config exported from the upstream UI.
- Self-service for the people being managed. There is no login for them; they only get a read-only share page.
- Running more than one instance of the manager, or handling more than a few hundred people.
- Managing the addons themselves: env vars, Redis, updates.

## 2. The upstream constraints that shape the design

1. **AIOStreams cannot give the admin a config.**
   - The admin endpoints under `/api/v1/dashboard/users` return metadata only (`AIOStreams/packages/server/src/routes/api/dashboard/index.ts:731-812`).
   - The config is encrypted with the user's password (`AIOStreams/packages/core/src/db/repositories/users.ts:131-135`).
   - So the manager has to **create** each config itself and keep the uuid and password (encrypted).
   - A config that someone else created can only be imported if the admin knows its password.
2. **AIOMetadata stores configs as plain JSON.**
   - The store is `user_configs.config_data` (`aiometadata/addon/lib/database.ts:541-600`).
   - The admin API can export every config at once (`database.ts:1392`) and can set any user's password (`index.ts:6703`, `database.ts:1370`).
   - So an admin can import any config there without knowing its password.
3. **In AIOStreams, a person's debrid keys are part of their config.** They sit in `services[].credentials` (`AIOStreams/packages/core/src/db/schemas.ts:343-351`). There is no separate place to store them.
4. **AIOStreams checks the whole config on every create and update.**
   - `validateConfig` runs with `bypassManifestCache: true` and fetches every addon manifest (`users.ts:117-122`, `users.ts:396-401`). A push can take several seconds and can fail because an addon is down.
   - Pushes therefore run as background jobs, never inside the HTTP request.

## 3. Tech stack

- **Framework: SvelteKit** with `adapter-node`, TypeScript, **Drizzle ORM**, and **Postgres** (the `manager` database in the shared `postgres:17` service from `deploy/compose.yaml`, reached through `DATABASE_URL`).
- **Packaging:** one stateless container. All state is in Postgres. It serves `GET /healthz` for the compose healthcheck and ships `wget`.
- **Background work:** jobs run in the same Node process, taken from a `jobs` table. There is no Redis.

Why this stack:
- SvelteKit form actions and server-only modules (`$lib/server`) keep secrets off the client without a separate API tier.
- Postgres is already in the stack, and the nightly `pg_dump` in `deploy/scripts/backup.sh` covers it. That makes the manager's backups the same as everyone else's.
- Drizzle lets a dev setup run on SQLite if you want, with no rewrite.
- Next.js would also work, but it is heavier than an admin tool with five screens needs.

Libraries:
- `oslo`/`@oslojs/otp` for TOTP.
- `arctic` for OIDC.
- `@node-rs/argon2` for password hashing.
- `qrcode` to draw the QR codes on the server as SVG.
- `zod` to validate request input.

## 4. Auth and deployment

- Caddy serves the manager on its own subdomain, `manage.example.com`, and forwards to `manager:3000` on the internal Docker network.
- The manager reaches the two services over the internal network (`http://aiostreams:3000`, `http://aiometadata:3232`). The links it gives out use the public URLs.
- **Admin login, two modes:**
  - OIDC, if `OIDC_ISSUER` is set. Only emails listed in `ADMIN_EMAILS` get in.
  - Otherwise, a local password (argon2id) plus TOTP, which is required. Five recovery codes are shown once.
- Sessions are kept in the database:
  - The cookie is `HttpOnly; Secure; SameSite=Lax`.
  - A session ends after 12 hours idle or 7 days in total.
  - Form posts are CSRF-protected by SvelteKit's origin check.
- **Share pages are the only public route**: `/s/:token`.
  - Caddy can add an IP allowlist or `forward_auth` for every other path.
  - Share pages have their own rate limit.

## 5. Handling secrets

- `MANAGER_KEY` is 32 random bytes (`openssl rand -hex 32`), set in `deploy/.env`. It is the key that encrypts data at rest.
- Every secret column is sealed with **AES-256-GCM** and stored as `v1:nonce:ciphertext:tag`.
  - Each value gets a random 12-byte nonce.
  - The AAD is `table.column.rowId`, so a value copied to another row will not decrypt.
  - `key_version` is stored so the key can be rotated: a CLI re-encrypts everything.
- **Secret values:**
  - Upstream passwords.
  - The AIOStreams `encryptedPassword` URL segment, because it works like a password.
  - Debrid and API keys.
  - Trakt and Simkl tokens.
  - The AIOStreams login and AIOMetadata `ADMIN_KEY` and `ADDON_PASSWORD`, if they are entered in the UI rather than in env.
- **Not secret:** template bodies, which contain only placeholders; uuids; hashes; the audit log.
- In templates and overrides, secrets appear only as placeholders such as `"{{secret:rd_key}}"`. They are filled in at push time and the result is kept in memory only.
- Scopes:
  - A `person` secret, such as a person's own Real-Debrid key, takes priority.
  - Otherwise a `shared` secret with the same name is used, such as the family's shared TorBox key.
  - If neither exists, the push fails.
- Stored secrets are shown masked (`••••1a2f`). They can be replaced but never read back through the UI.
- Upstream passwords are generated with 32 random bytes in base64url. AIOStreams needs at least 6 characters (`users.ts:82`).
- **The rendered config always contains secrets.** Diffs and the audit log therefore show only hashes and the paths that changed, never the values.

## 6. Data model (Drizzle, Postgres)

| Table | Columns |
|---|---|
| `admins` | id, email, password_hash?, totp_secret_enc?, recovery_codes_hash[], oidc_sub?, created_at |
| `sessions` | id (hash), admin_id, expires_at, last_seen_at, ip, user_agent |
| `instances` | id, kind (`aiostreams`/`aiometadata`), internal_url, public_url, auth_json_enc (AIOStreams login user/pass, or AIOMetadata admin_key + addon_password), created_at |
| `templates` | id, name, kind, description, current_version_id, created_at |
| `template_versions` | id, template_id, version (int), body_json (with placeholders), required_secrets[], note, created_by, created_at |
| `people` | id, display_name, notes, tags[], disabled (bool), created_at |
| `person_bindings` | id, person_id, instance_id, template_id, pinned_version_id? (null means follow latest), overrides_json (RFC 7386 merge patch), UNIQUE(person_id, instance_id) |
| `secrets` | id, scope (`shared`/`person`), person_id?, name, value_enc, hint (last 4), updated_at, UNIQUE(scope, person_id, name) |
| `accounts` | id, binding_id, remote_uuid, password_enc, manifest_secret_enc (AIOStreams encryptedPassword), manifest_url_enc, state (`active`/`rotating`/`retired`/`error`), desired_hash, pushed_hash, remote_hash, rendered_from_version_id, last_push_at, last_check_at, last_error, created_at, retired_at |
| `share_tokens` | id, person_id, token_hash (sha256), expires_at?, max_views?, views, revoked_at?, created_at |
| `jobs` | id, type (`push`/`check`/`rotate`/`import`/`delete`), account_id?, payload_json, status, attempts, run_after, error, created_at, finished_at |
| `audit_log` | id, at, actor (admin id / `system`), action, target_type, target_id, summary, diff_paths_json, ip |
| `health_samples` | id, instance_id, at, endpoint, ok, latency_ms, body_excerpt |

## 7. Integration adapters

Both adapters share one interface:

```
create(config): {uuid, password, manifestUrl, manifestSecret?}
read(uuid, password): config
update(uuid, password, config)
delete(uuid, password?)
health()
```

Callers never see the difference between the two services.

### 7.1 AIOStreams

All routes are mounted at `/api/v1` (`AIOStreams/packages/server/src/app.ts:120-147`). Every response is wrapped as `{success, detail, data, error}` (`AIOStreams/packages/server/src/utils/responses.ts`).

| Operation | Request | Response | Code |
|---|---|---|---|
| Exists | `HEAD /api/v1/user?uuid=` | 200 if it exists, otherwise an error | `routes/api/user.ts:71-107` |
| Create | `POST /api/v1/user` `{config, password}` | 201 `data:{uuid, encryptedPassword}` | `user.ts:178-229`, `users.ts:78-160` |
| Read | `GET /api/v1/user?raw=true` + `Authorization: Basic b64(uuid:password)` | `data:{userData, encryptedPassword}`, with `accessKey` removed | `user.ts:110-175` |
| Update | `PUT /api/v1/user` `{config}` + Basic | `data:{uuid, userData}` (full replace, validated) | `user.ts:246-301`, `users.ts:357-437` |
| Delete | `DELETE /api/v1/user` + Basic | 200 | `user.ts:303-339` |
| Admin login (optional) | `POST /api/v1/auth/login` `{username, password}`, which sets a session cookie | cookie | `routes/api/auth/index.ts:26` |
| List users (for orphan checks) | `GET /api/v1/dashboard/users?q=&page=&limit=` (admin session) | paged metadata | `dashboard/index.ts:731` |
| Health | `GET /api/v1/status` and `GET /api/v1/health` | status info / OK | `routes/api/status.ts:191`, `health.ts:12` |

Things the adapter has to handle:
- **Basic auth only takes the raw password.** An encrypted password is refused (`utils/basic-auth.ts:83-90`, `allowEncrypted:false`). The manager stores the raw password.
- **The manifest link is `{public}/stremio/{uuid}/{encryptedPassword}/manifest.json`** (`app.ts:197`).
  - `encryptString` uses a random IV (`core/src/utils/crypto.ts:94`), so every GET returns a different segment. All of them work.
  - Keep the segment from create. That way the link does not change on every sync.
- **`AIOSTREAMS_AUTH_REQUIRED=true` blocks config saves without a login.** Creates and updates need a logged-in session: `injectAccessKey` puts `accessKey` into the config only when `req.user` is set (`middlewares/auth.ts:187-195`).
  - The manager logs in with a dedicated account that holds the create-config permission.
  - It keeps the cookie and logs in again when it gets a 401.
- **The service normalizes what it stores.** It drops `trusted`, `ip`, `activeVariants`, `autoVariants`, `healthResults` and `variantSelectorLocation` (`users.ts:86-91`, `369-374`). Drift checks ignore these fields.
- **Rate limits:**
  - `USER_CREATE_RATE_LIMIT_*` defaults to 10 per IP.
  - `userApiRateLimiter` also applies (`user.ts:66`).
  - Every request from the manager comes from one internal IP, so jobs run with a concurrency of 2 and back off on 429. Raise the create limit if you create many people at once.
- **Native inheritance:**
  - AIOStreams has `parentConfig: {uuid, password, mergeStrategies}` (`schemas.ts:716-735`), merged in `core/src/utils/config.ts:1594`.
  - The MVP does not use it, because every child would carry the parent's password and a change to the parent would take effect for everyone at once, without a push.
  - This is a v2 option ("live template"). For it, set `mergeStrategies.services: 'override'` so the parent's debrid keys are not shared.

### 7.2 AIOMetadata

Routes are registered in `aiometadata/addon/index.ts:710-712` and handled in `aiometadata/addon/lib/configApi.js`.

| Operation | Request | Response | Code |
|---|---|---|---|
| Create | `POST /api/config/save` `{config, password, addonPassword}`. **Never send `userUUID`**. | `{success, userUUID, installUrl, message}` | `configApi.js:253-570` |
| Read | `POST /api/config/load/:uuid` `{password, addonPassword}`. This is POST, not GET, and has its own rate limit. | `{success, userUUID, installUrl, config}` | `index.ts:711`, `configApi.js:581-646` |
| Update | `PUT /api/config/update/:uuid` `{config, password, addonPassword}` | `{success, userUUID, installUrl, message}` | `configApi.js:653-966` |
| List | `GET /api/admin/users?q=&limit=&offset=` + `x-admin-key` | `{users:[{uuid, created_at, last_updated, is_active, ...}], total}` | `index.ts:6654`, `database.ts:1256` |
| Detail | `GET /api/admin/users/:uuid` | `{user:{uuid, api_keys:{tmdb:bool...}, catalogs_count, ...}}` | `index.ts:6685`, `database.ts:1327` |
| Set password | `POST /api/admin/users/:uuid/reset-password` `{newPassword}` | `{success:true}`. The password is not returned, so the manager chooses it. | `index.ts:6703`, `database.ts:1370` |
| Export all | `GET /api/admin/users/export` | `{users:[{uuid, config}]}`, which contains **plain-text keys** | `index.ts:6672`, `database.ts:1392` |
| Delete | `DELETE /api/admin/users/:uuid` | `{success:true}` | `index.ts:6767` |
| Health | `GET /health/live`, `GET /health/ready` (deep dependency check) | JSON | `index.ts:176-215` |

Things the adapter has to handle:
- **`saveConfig` overwrites without checking the password.** It takes an optional `userUUID` from the body and upserts it (`configApi.js:329`, `database.ts:566-590`).
  - The manager only calls save to create. It always uses update, which checks the password, for changes.
  - `ADDON_PASSWORD` must be set upstream, because it is the only protection for this path.
- **The service adds fields when it saves:** `lastModified`, `configVersion` (`configApi.js:335-352`) and `configHash` (`database.ts:556-563`). Drift checks ignore them.
- **Admin requests must carry `x-admin-key`.**
  - `requireDashboardAdmin` accepts the header, or an OIDC session with the admin permission (`index.ts:7158-7183`).
  - The adapter always sends the header.
  - If OIDC sign-in is required, config writes also need a session (`addon/lib/signinGate.ts:88-100`). Leave `signinRequired` off, or give the manager an OIDC client.
- **The manifest link is `{HOST_NAME}/stremio/{uuid}/manifest.json`** (`addon/lib/installUrl.js:10`). Use the `installUrl` from the response as it is.

## 8. Sync algorithm

**Render** (a pure function):
1. `base = template_versions[pinned or current].body_json`
2. `merged = jsonMergePatch(base, binding.overrides_json)`
3. `resolved = substitutePlaceholders(merged, personSecrets ∪ sharedSecrets)`. A missing secret is an error.
4. Validate the kind: basic zod shape, and for AIOStreams, `services[].credentials` must not be empty.
5. `desired_hash = sha256(canonicalJson(strip(resolved)))`.

`strip()` removes the fields the service fills in (see 7.1 and 7.2), then sorts the keys.

Arrays are replaced whole by a merge patch. That is why templates put per-person values in placeholders instead of array overrides.

**Push** (a job for each account):
1. Render.
2. Create or update through the adapter.
3. Read the config straight back.
4. `remote_hash = hash(strip(readBack))`. Set `pushed_hash = desired_hash` and `rendered_from_version_id`.
5. Write to the audit log which paths changed: a key-path diff of the stripped desired config, with values removed.

**Check** (cron every 6 hours, or a button):
1. Read the remote config and hash it into `h`. Render the desired config and hash it into `d`.
2. Pick the status:

| Condition | Status | Meaning |
|---|---|---|
| `h != remote_hash` | **Drifted** | Someone edited it in the upstream UI, or it was changed by an upstream version upgrade. |
| `d != pushed_hash` | **Pending** | The template, the overrides or a secret changed since the last push. |
| Neither | **In sync** | |
| Read fails with 401/404 | **Missing** | The config was deleted upstream or its password changed. Offer re-create or re-import. |

3. For a drifted config, the UI shows a masked diff and three choices:
   - Overwrite: push the desired config.
   - Adopt: turn the remote changes into this person's overrides.
   - Ignore.

**Bulk re-push:**
1. Saving a new template version lists every binding that follows the latest version, along with its dry-run hashes.
2. After the admin confirms, the manager queues push jobs with a concurrency of 2 and a 250 ms gap between jobs. If an account fails, the others keep going.
3. A progress bar is fed by SSE from the job table.

**Rotate:**
1. Create a new config with the same rendered body.
2. Save the new account as `active` and mark the old one `retired`.
3. Refresh the share page.
4. Delete the old config upstream: Basic DELETE for AIOStreams, admin DELETE for AIOMetadata.

**Revoke** is the same as rotate, but no new config is created, the person is marked disabled, and share tokens are revoked.

**Import:**
- AIOStreams: the admin enters the uuid and password.
  1. HEAD to confirm it exists, then GET with `raw=true`.
  2. Store the credentials.
  3. Offer to diff the config against a template to build the overrides. Secrets found in `services[].credentials` go into person secrets.
- AIOMetadata: pick from the admin list.
  1. Choose a new password and set it with reset-password.
  2. Load the config the same way as for AIOStreams, then import it.
- **The person's old AIOMetadata password stops working once it is reset.** The UI says so before the import runs.

## 9. Screens

**Dashboard**
```
+----------------------------------------------------------------------+
| AIO Manager            Dashboard  People  Templates  Secrets  Audit  |
+----------------------------------------------------------------------+
| Health                                                               |
|  AIOStreams   v2.34.1  status OK  health OK (db)   212 ms  [details]  |
|  AIOMetadata  v3.0.0   live OK    ready WARN redis 38 ms   [details]  |
|                                                                      |
| Sync           In sync 21 | Pending 4 | Drifted 1 | Missing 0 | Err 1  |
|  [Push all pending]  [Check all now]                                 |
|                                                                      |
| Jobs  push  Grandma / AIOStreams   running (validating addons...)    |
|       push  Sam / AIOMetadata      done 1.2s                         |
|                                                                      |
| Recent audit   09:12 alice  template.version  "Family" v7            |
|                09:13 system bulk_push          4 queued              |
+----------------------------------------------------------------------+
```

**People list**
```
+----------------------------------------------------------------------+
| People (26)                      [search.....]  [+ Add person] [Import]|
+----------------------------------------------------------------------+
| Name        Tags     Streams template   Metadata template   Status    |
| Grandma     family   Family v7          Family v3           in sync   |
| Sam         anime    Anime fan v2       Anime fan v4        PENDING   |
| Uncle Joe   family   Family v6 (pinned) Family v3           DRIFTED   |
| Old laptop  -        -                  Family v3           missing   |
|                                  [x] selected: [Push] [Check] [Tag]  |
+----------------------------------------------------------------------+
```

**Person detail**
```
+----------------------------------------------------------------------+
| < People   Sam                                   [Share page] [...]   |
+----------------------------------------------------------------------+
| AIOStreams   template [Anime fan  v] version [latest v]   PENDING     |
|   uuid 3f2c...a91   created 2026-08-02   last push 2026-09-20         |
|   Overrides (merge patch)          | Rendered preview (secrets masked) |
|   { "formatter": {"id":"torbox"} } | { "services":[{"id":"realdebrid",|
|                                    |   "credentials":{"apiKey":"****"}|
|   [Diff vs remote] [Push] [Rotate] [Delete upstream]                  |
| AIOMetadata  template [Anime fan  v] version [latest v]   in sync     |
|   uuid 81d0...77c   [Diff] [Push] [Rotate]                             |
| Secrets for Sam                                                       |
|   rd_key      person  ••••1a2f  [replace] [remove]                    |
|   trakt_token person  ••••9c0e  [replace]                             |
|   tb_key      (shared fallback)                                       |
| History  09-20 push ok (paths: formatter.id) ...                      |
+----------------------------------------------------------------------+
```

**Template editor**
```
+----------------------------------------------------------------------+
| Templates > Family (AIOStreams)          v7 current   [Versions v]   |
+----------------------------------------------------------------------+
| [Paste from AIOStreams export]  [Extract secrets -> placeholders]     |
| +-----------------------------------+  Required secrets              |
| | { "services": [ { "id":           |   rd_key   12/14 people have   |
| |   "realdebrid", "credentials":    |   tb_key   shared              |
| |   {"apiKey":"{{secret:rd_key}}"}  |  Used by 14 people (12 follow   |
| |   }], "presets": [ ... ] }        |  latest, 2 pinned)             |
| +-----------------------------------+                                |
| Note [Add Comet preset............]                                  |
| [Validate] [Save as v8]  -> then: [Dry-run: 12 will change] [Push 12] |
+----------------------------------------------------------------------+
```
- Pasting an upstream export runs a scan for things that look like keys: `credentials.*`, `apiKey`, `token`, `*Key`.
- Each match is offered for replacement with a named placeholder, so a template never stores a raw key.

**Share page** (public, `/s/:token`)
```
+----------------------------------------------+
|  Stremio setup for Sam                       |
|                                              |
|  1. Streams (AIOStreams)                     |
|     [ Install in Stremio ]  (stremio://...)  |
|     [ Copy manifest URL ]   [QR]             |
|  2. Metadata (AIOMetadata)                   |
|     [ Install in Stremio ]   [Copy] [QR]     |
|                                              |
|  Install Metadata first, then Streams, and   |
|  remove Cinemeta if asked.                   |
|  This link expires 2026-09-30.               |
+----------------------------------------------+
```
- The deeplink is the manifest URL with `https://` replaced by `stremio://`.
- The QR code encodes the https URL, which works on phones and TVs.
- Pages send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and are marked `noindex`.

**Other screens:**
- Secrets: the shared secrets and which people use them.
- Audit log: filter by person and action.
- Settings: instances, admins and TOTP, and the backup key check.

## 10. Manager API routes

These are SvelteKit `+server.ts` routes. All of them need an admin session except `/s/*`.

```
POST   /auth/login | /auth/totp | /auth/logout | GET /auth/oidc/callback
GET    /api/health                         -> both instances, cached 30s
GET    /api/people            POST /api/people
GET    /api/people/:id        PATCH/DELETE /api/people/:id
PUT    /api/people/:id/bindings/:instance  {templateId, pinnedVersionId?, overrides}
GET    /api/people/:id/bindings/:instance/render   -> masked preview + hashes
GET    /api/people/:id/bindings/:instance/diff     -> masked remote vs desired
POST   /api/people/:id/bindings/:instance/{push|check|rotate|adopt}
POST   /api/people/:id/revoke
PUT    /api/secrets/{shared|person/:id}/:name      {value}   DELETE same
GET    /api/templates          POST /api/templates
POST   /api/templates/:id/versions   {body, note}
POST   /api/templates/:id/dry-run    -> affected bindings
POST   /api/templates/:id/push       -> job ids
POST   /api/import/aiostreams  {uuid, password, personId?}
GET    /api/import/aiometadata/candidates
POST   /api/import/aiometadata {uuid, personId?}  (resets password)
POST   /api/people/:id/share-tokens {expiresInDays?, maxViews?}
DELETE /api/share-tokens/:id
GET    /api/jobs?status=      GET /api/jobs/stream (SSE)
GET    /api/audit?person=&action=
GET    /s/:token                          public share page
```

## 11. Security considerations

- **`MANAGER_KEY` and the `manager` database together hold every debrid key and every upstream password.**
  - `deploy/scripts/backup.sh` puts `.env` (and so this key) inside the restic repository, which restic encrypts. Keep the restic password and a copy of `.env` in a password manager, not on the server alone.
  - A database dump is useless without the key.
- **`SECRET_KEY` must be backed up too.** The manager stores AIOStreams manifest links, and those depend on the AIOStreams `SECRET_KEY` staying the same.
- **Share tokens:**
  - 32 random bytes; only their hash is stored.
  - They can expire and be revoked, and have an optional view limit.
  - A share page shows install links, which are credentials themselves, so rotate the manifest if a link leaks.
- **Least privilege upstream:**
  - The AIOStreams manager account should not be an admin unless orphan detection is wanted. Accounts missing from `AIOSTREAMS_AUTH_PERMISSIONS` **default to admin**, so list the manager's account there explicitly.
  - AIOMetadata's `ADMIN_KEY` has full power; keep it only in the manager's env.
- **Secret values must not leak** into logs, errors, the audit log or HTTP responses.
  - Adapter errors are cleaned before they are stored.
  - Only one value comes back to an admin, a masked hint (the last 4 characters of a secret).
- Mitigate the upstream AIOMetadata `saveConfig` overwrite (section 7.2) with `ADDON_PASSWORD`.
- **Headers:** the manager sends a strict CSP, `frame-ancestors 'none'`, and HSTS through Caddy.
- **Login protection:** failed logins are rate-limited, and the audit log records every login.

## 12. Build plan

**Phase 0: skeleton (1 to 2 evenings)**
- SvelteKit, Drizzle schema, encryption helper with tests.
- Local login with TOTP, audit log helper, Docker image, Caddy block.

**Phase 1: MVP**
- Instances settings, health panel.
- Templates as JSON with versions, placeholders, shared and person secrets.
- People with bindings and overrides.
- Render, create, push and check for both adapters. Job runner with SSE progress.
- Share page with deeplinks, QR codes and tokens that expire.
- Rotate and revoke.
- Import: AIOStreams by uuid and password; AIOMetadata from the admin list with a password reset.

**Phase 2**
- Bulk re-push with a dry run.
- A drift screen with masked diffs and "adopt as overrides".
- Scheduled checks every 6 hours, with a notification (ntfy or email) on drift or missing configs.
- OIDC login.
- Orphan report: upstream uuids that the manager does not know about.
- Nightly encrypted export of the manager DB.

**Phase 3 (v2)**
- A "live template" mode through AIOStreams `parentConfig`.
- A form-based editor for common fields, such as the debrid service picker and the catalog list.
- Per-person usage from the AIOStreams analytics endpoints (`dashboard/index.ts:579`).
- Multiple admins with roles.
- A Postgres option.
