# Upstream services for tests

Two ways to test against AIOStreams and AIOMetadata:

1. **Real services built from source**: `scripts/upstream/*.sh`. Use these to record fixtures and for slow integration runs.
2. **In-memory mocks**: `tests/mocks/index.ts`. Use these for every vitest run. They need no network and no build.

Upstream versions used: AIOStreams `b3bf75b` (2.34.1) and aiometadata `7ef886c` (3.0.0). In the citations below, `AIOStreams/` paths are relative to `packages/`, and `aiometadata/` paths are relative to the repository root.

## 1. Real services

| Service     | Status                                                                                                             | Start                                                    | URL                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------- |
| AIOMetadata | **Runs.** Verified end to end. Fixtures are recorded.                                                              | `scripts/upstream/aiometadata.sh start`                  | http://localhost:13232 |
| AIOStreams  | **Script is written but not verified.** In this sandbox the build was stopped by the permission guard (see below). | `scripts/upstream/aiostreams.sh start` (or `start-auth`) | http://localhost:13000 |

Every script takes `start|stop|restart|status|logs|reset|build`. Everything lives in the gitignored `manager/.upstream/`:

- `tools/`: Node 24 and pnpm 11. Both upstreams need Node >= 24; the manager keeps Node 22.
- `src/`: the clones. They are made on first use; override the location with `AIOSTREAMS_SRC` or `AIOMETADATA_SRC`.
- One data directory, pid file and log per service.

### AIOMetadata

Environment set by the script:

- `PORT=13232`, `HOST_NAME=http://localhost:13232`, `NODE_ENV=production`.
- `ADMIN_KEY=dev-admin-key`, `ADDON_PASSWORD=dev-addon-password`.
- `DATABASE_URI=sqlite://.upstream/aiometadata/data/db.sqlite`.
- `REDIS_URL=redis://127.0.0.1:16379`.
- Warmers are off: `ENABLE_CACHE_WARMING`, `MAL_WARMUP_ENABLED`, `TMDB_POPULAR_WARMING_ENABLED`, `CATALOG_WARMUP_AUTO_ON_EPOCH_CHANGE` and `CACHE_CLEANUP_AUTO_ENABLED` are all `false`.
- No external API keys.

The build runs `npm ci`, then `npm rebuild better-sqlite3 bcrypt`, then `npm run build:backend`. The rebuild is needed because npm 11 skips unapproved install scripts. The frontend is not built.

**Redis 8.** AIOMetadata uses `HSETEX`/`HTTL`, so it needs Redis 8. How each option went:

1. apt `redis-server` is 7.0.15. Too old.
2. `download.redis.io` returns 403 from the proxy, and so does the GitHub archive/codeload tarball. `redis-memory-server` downloads from download.redis.io too, so it was not tried.
3. **What works:** `git clone --depth 1 --branch 8.2.2 https://github.com/redis/redis`, then `make BUILD_TLS=no MALLOC=libc`. It takes about 2 minutes. `ensure_redis8` in `common.sh` does this, and it reuses a system redis-server when that one is already >= 8.

`/health/live` answers before the readiness gate opens. The script therefore also waits for `/api/config/addon-info`, which answers 503 until the service is ready (`aiometadata/addon/lib/lifecycle/readiness.ts:106`).

### AIOStreams

Environment set by the script:

- `PORT=13000`, `BASE_URL=http://localhost:13000`, `NODE_ENV=production`.
- A fixed dev `SECRET_KEY` (`000102…1f`), so the data survives a restart.
- `DATABASE_URI=sqlite://.upstream/aiostreams/data/db.sqlite`.
- `AIOSTREAMS_AUTH=manager:managerpass`, `AIOSTREAMS_AUTH_PERMISSIONS=manager=admin`.
- `USER_CREATE_RATE_LIMIT_MAX_REQUESTS`, `USER_API_RATE_LIMIT_MAX_REQUESTS` and `LOGIN_RATE_LIMIT_MAX_REQUESTS` are all `10000`. The names come from `AIOStreams/core/src/config/schema/rate-limits.ts:29,38`, which builds them as `<PREFIX>_RATE_LIMIT_{WINDOW,MAX_REQUESTS}`. `DISABLE_RATE_LIMITS=true` would turn every limiter off.
- `start-auth` also sets `AIOSTREAMS_AUTH_REQUIRED=true`.

The build runs `pnpm install`, then `pnpm -F crypto|core|server run build`. The SPA is skipped unless `AIOSTREAMS_BUILD_FRONTEND=1`.

**Blocker in this sandbox.** `packages/core` depends on `github:viren070/torbox-sdk-js#dist`, and pnpm fetches that from `codeload.github.com`, which the proxy refuses (403). The script works around it:

1. It clones that repo with git, at the exact commit pinned in `pnpm-lock.yaml` (`82fb4eb`).
2. It adds a pnpm `overrides` entry that points at the clone.

`pnpm install` then worked. The build that followed was denied by the Claude Code permission classifier ("untrusted code integration"), so AIOStreams has never run here.

On a machine with normal GitHub access, set `AIOSTREAMS_NO_TORBOX_OVERRIDE=1` and it builds as upstream intends. Then record fixtures with:

```
scripts/upstream/aiostreams.sh start      && pnpm tsx scripts/upstream/record-fixtures.ts aiostreams
scripts/upstream/aiostreams.sh restart    # after stop
scripts/upstream/aiostreams.sh stop && scripts/upstream/aiostreams.sh start-auth \
  && pnpm tsx scripts/upstream/record-fixtures.ts aiostreams-auth
```

`mocks.spec.ts` checks the mock against `fixtures/aiostreams*.json` automatically once those files exist.

### Recording fixtures

`pnpm tsx scripts/upstream/record-fixtures.ts <aiometadata|aiostreams|aiostreams-auth>`

- It runs the manager flow from `tests/mocks/flows.ts` against the live service.
- It writes `tests/mocks/fixtures/<name>.json`, holding the request, status, selected headers and body of every step.
- It exits 1 if any status differs from `expectStatus`.
- Nothing is scrubbed, because every value is a dev value.

Current fixtures: `fixtures/aiometadata.json`, 31 exchanges, all statuses as expected.

## 2. Minimal valid configs (seed template bodies)

These are exported from `tests/mocks/configs.ts` (and re-exported by `tests/mocks/index.ts`).

**AIOStreams**

```json
{ "presets": [], "formatter": { "id": "gdrive" }, "sortCriteria": { "global": [] } }
```

`UserDataSchema` (`AIOStreams/core/src/db/schemas.ts:739`) has only three required fields: `formatter`, `sortCriteria` (with `global`), and `presets`.

- `formatter.id` must be one of `gdrive|prism|tamtaro|lightgdrive|minimalisticgdrive|torrentio|torbox|custom`.
- With `presets: []`, `validateConfig` builds no addons and fetches no manifests (`core/src/main/setup.ts`, `core/src/utils/config.ts:529`), so create and update work offline.
- A debrid key goes in `services: [{ id: "realdebrid", enabled: true, credentials: { apiKey } }]`. `validateService` checks the credential types only and makes no network call (`config.ts:1147`).

This is derived from source only: the real server did not run.

**AIOMetadata** (verified)

```json
{ "language": "en-US", "apiKeys": { "tmdb": "dev-tmdb-key" } }
```

- `apiKeys.tmdb` must be a non-empty string unless the server sets `BUILT_IN_TMDB_API_KEY` (`aiometadata/addon/lib/configApi.js:118-157`).
- The key is not checked against TMDB when the config is saved.
- `apiKeys.fanart` becomes required when any art provider is `fanart`.
- A config with only `apiKeys.tmdb` also saves, and its manifest renders.

## 3. Discrepancies vs spec section 7

### AIOStreams

These come from reading the source. The mock implements them.

1. **Update response has no `userData`.** Spec says `data:{uuid, userData}`. `UserRepository.updateUser` returns `Promise<void>` (`core/src/db/repositories/users.ts:357-361`), so `userData: undefined` drops out of the JSON (`server/src/routes/api/user.ts:281-290`). The real response is `data:{uuid}`. Re-read with GET if the stored form is needed.
2. **"Not found" is 400, not 404.**
   - HEAD for a missing uuid, and any GET/PUT/DELETE with a wrong password or missing uuid, return **400** `USER_INVALID_DETAILS "Invalid UUID or password"` (`user.ts:98`, `users.ts:237-239,275-279,380-386,455-460`; status set at `core/src/utils/constants.ts:65-68`).
   - The adapter cannot tell "missing" from "wrong password" except by HEAD. HEAD is 200 or 400, and has no body.
3. **Errors are enveloped.** The shape is `{success:false, detail:null, data:null, error:{code,message}}` (`server/src/middlewares/errors.ts:95-103`). `createResponse` turns a falsy `data` into `null`, so DELETE returns `data:null`.
4. **Status codes the adapter must handle:**
   - A missing Basic header is **400** `MISSING_REQUIRED_FIELDS` (`user.ts:118-126`).
   - A non-Basic scheme is **400** `BAD_REQUEST` (`utils/basic-auth.ts:43-48`).
   - An encrypted password in Basic auth is **401** `UNAUTHORIZED` (`basic-auth.ts:83-90`, as the spec says).
   - A password shorter than 6 characters is **400** `USER_NEW_PASSWORD_TOO_SHORT` (`users.ts:82-84`). The manager's generated passwords must be at least 6 characters.
   - Schema or addon failures are **400** `USER_INVALID_CONFIG`, carrying the zod or addon message (`users.ts:123-131`, `404-417`).
   - The rate limiter returns **429** `RATE_LIMIT_EXCEEDED` with `RateLimit-*` and `Retry-After` headers (`server/src/middlewares/ratelimit.ts:59-80`).
5. **`AIOSTREAMS_AUTH_REQUIRED=true`: saving without a session is 401 `ADDON_PASSWORD_INVALID`, not `UNAUTHORIZED`.** The error is thrown by `assertConfigAccessKey` (`core/src/utils/auth.ts:410-424`, called at `users.ts:85,368`).
   - The adapter must treat both codes as "log in again".
   - With a session, `injectAccessKey` writes the instance's access key **into the stored config** (`server/src/middlewares/auth.ts:187-195`). GET removes it again (`user.ts:161-163`).
   - Reads (HEAD/GET) and DELETE need no session.
   - Setting the legacy `ADDON_PASSWORD` env on AIOStreams silently becomes the access key and turns `authRequired` on (`core/src/utils/auth.ts:372-392`).
6. **Login details.**
   - `POST /api/v1/auth/login` returns `data:{username,isAdmin,permissions,source:'password'}`, and **401** `UNAUTHORIZED` for bad credentials (`server/src/routes/api/auth/index.ts:26-73`).
   - The cookie is `aiostreams.session`: `HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`, and `Secure` only when the request is https (`middlewares/auth.ts:16,41-47`). The lifetime comes from `SESSION_TTL_SECONDS`.
   - **The login limiter defaults to 5 attempts per 300 s** (`rate-limits.ts:157-162`). Logging in again on every 401 in a loop will lock the manager out.
7. **Dashboard routes redirect unless the request asks for JSON.**
   - `requireAdmin` answers **302 → /login** when `req.accepts(['html','json'])` resolves to html. That is the case when the Accept header is missing or `*/*`, which is fetch's default (`middlewares/auth.ts:216-219,241-243`).
   - Always send `Accept: application/json`. With it, the answers are 401 or 403 in the envelope.
8. **Dashboard list shape.**
   - `GET /dashboard/users?q=&page=&limit=&sort=&dir=` returns `data:{items:[{uuid,createdAt,updatedAt,accessedAt,requests24h}], total, page, limit, pages}`, with a limit of at most 200 (`server/src/routes/api/dashboard/index.ts:731-741`, `core/src/db/repositories/admin-users.ts:35-80`).
   - `q` is a substring match (`LIKE %q%`).
   - The spec does not mention it, but **`DELETE /api/v1/dashboard/users/:uuid` deletes a config without its password**, with an admin session (`dashboard/index.ts:755-769`).
9. **The stored config is not the config sent.** `validateConfig` returns the zod output, and that output is what gets encrypted and stored (`users.ts:117,135,404,420`):
   - Unknown top-level keys are stripped (plain `z.object`, `schemas.ts:739`).
   - `checkOwned: true` is added (`schemas.ts:1149` `.default(true)`).
   - `proxy` is always set, `{}` when unused (`config.ts:438`, `1379-1461`).
   - `trusted: false` is written on create.
   - On PUT, `uuid` is written (`user.ts:279`).
   - On every read, `trusted` and `uuid` are **added** (`users.ts:249-250`), and `ip`, `activeVariants`, `autoVariants`, `healthResults` and `variantSelectorLocation` are removed. `applyMigrations` may also rewrite legacy fields (`config.ts:581+`).
   - Drift checks should ignore `AIOSTREAMS_NORMALIZED_KEYS` and treat `AIOSTREAMS_DEFAULTED_FIELDS` as equal when absent (both in `configs.ts`).
   - The spec says `trusted` is dropped. It is stored as `false` and re-added on read.
10. **Rate limits are tighter than the spec says.**
    - `userApiRateLimiter` defaults to **5 requests per 5 s per IP**, across every `/api/v1/user` method (`rate-limits.ts:64-69`, `user.ts:66`).
    - A push is a GET plus a PUT, so two concurrent jobs already use most of that budget. Keep concurrency at 2 or lower, back off on 429, or raise `USER_API_RATE_LIMIT_MAX_REQUESTS`.
    - The create limit is 10 per 3600 s.
11. **Health.**
    - `GET /api/v1/health` returns `{success:true, detail:'OK', data:null, error:null}` (`routes/api/health.ts:12-22`).
    - Its error path passes the message as `statusCode` (`health.ts:19`), so a failing health check probably shows up as a 500 or a crash, not a clean error.
    - `GET /api/v1/status` has `data.version`, `data.tag`, `data.channel`, `data.settings.protected` (auth required) and more (`routes/api/status.ts:20-190`).
12. **`encryptedPassword` format.** It is url-safe base64 of `{"i":iv,"e":ciphertext,"t":"a"}`: AES-256-CBC over deflated text, with a random IV (`core/src/utils/crypto.ts:94-115`). Every GET returns a new one and all of them work, as the spec says.

### AIOMetadata

These are confirmed against the real service; see `fixtures/aiometadata.json`.

1. **Error bodies are `{error: string}`** (sometimes with extra fields) and never have `success:false`.
2. **Load of a missing or deleted uuid returns 401, never 404.**
   - Without `addonPassword`: **401** `"Invalid addon password. Contact the addon administrator."`. The uuid is no longer trusted, because delete removes the `trusted_uuids` row (`addon/lib/database.ts:785-788`, check at `configApi.js:614-619`).
   - With `addonPassword`: **401** `"Invalid UUID or password"` (`configApi.js:620-623`).
   - Update behaves the same way. Use the admin detail endpoint to tell "missing" from "wrong password".
3. **Trust changes which calls need the addon password.** `save` marks the uuid trusted (`configApi.js:369`), so later load and update calls skip the addon password check. Sending it anyway is harmless. `update` never grants trust.
4. **Save requires `apiKeys.tmdb`.** Without it the response is 400 `{error:"Missing required API keys: tmdb", missingKeys:["tmdb"]}` (`configApi.js:118-163,291-297`). Update applies the same check. See the minimal config above.
5. **Missing fields, in the order they are checked.**
   - Save checks `config`, then `password` (both 400), then the addon password (401) (`configApi.js:265-288`).
   - Update checks `password` first, then `config` (`configApi.js:672-678`).
6. **Load response.**
   - It is `{success,userUUID,installUrl,config}`.
   - `config.apiKeys` is always present. It is spread, and `customDescriptionBlurb` is set to `undefined`, so that key never comes back (`configApi.js:600-606,630-645`). Drift checks should ignore `apiKeys.customDescriptionBlurb`.
   - `lastModified`, `configVersion` and `configHash` are added, as the spec says. `configHash` is `md5(JSON.stringify(config without configHash)).slice(0,16)` (`database.ts:556-563`).
   - On save, `configVersion` equals `Date.now()`; on update it is `Date.now()+1`.
7. **Save with `userUUID`** replies `"Configuration updated successfully"` and **overwrites the password hash** without checking the old one (`configApi.js:330-358`). This is confirmed.
8. **Admin list.**
   - The response is `{total, users:[{uuid, alias, created_at, last_updated, last_activity:null, total_requests:0, has_api_keys, config_status:'configured', is_active}]}` (`database.ts:1256-1325`).
   - `limit` defaults to 100 and is clamped to 1..500.
   - **`q` is a uuid prefix match** (or an exact alias), not a substring match.
   - `is_active` means the config was updated within the last 7 days.
9. **Timestamps depend on the database.** On SQLite, `created_at`, `last_updated` and `updated_at` look like `"2026-09-23 18:05:29"`: UTC with no zone marker. On Postgres they are ISO strings (`database.ts:1291-1322`). Parse both forms.
10. **Admin detail** returns `{user:{uuid, created_at, last_updated, last_activity, total_requests, api_keys:{tmdb,tvdb,imdb,kitsu}, streaming_services, catalogs_count, language, region}}`, or 404 `{error:'User not found'}` (`database.ts:1327-1368`).
11. **Reset password.**
    - It returns `{success:true}`, or 404 for an unknown uuid.
    - `newPassword` is optional upstream: without it, a random 8-character password is set **and never returned** (`database.ts:1370-1373`). The adapter must always send `newPassword`.
12. **Export.**
    - The response is `{exportDate, totalUsers, users:[{uuid, created_at, updated_at, config}]}`, with `Content-Disposition: attachment` (`index.ts:6672-6683`, `database.ts:1392-1432`).
    - The configs are complete, including `configHash`, and hold plain-text keys.
13. **Delete.**
    - `DELETE /api/admin/users/:uuid` returns `{success:true, message:'User deleted successfully'}`, or 404 `{error:'User not found'}` (`index.ts:6767-6784`).
    - There is also a user-level `DELETE /api/config/delete-user/:uuid` with `{password, addonPassword}` (`index.ts:6839`).
14. **Admin auth.**
    - A missing or wrong `x-admin-key` is 401 `{error:'Unauthorized'}` (`index.ts:7158-7183`).
    - With `ADMIN_KEY` unset, the 401 also carries a `message`.
15. **Load rate limit.**
    - 20 per uuid per minute (`CONFIG_LOAD_RATE_LIMIT_PER_MIN`), answered with 429 `{error:"Too many login attempts. Please try again shortly."}` (`index.ts:340-373`). Confirmed: the 21st load answers 429.
    - It applies only while Redis is configured. Save and update have no limiter.
16. **Health.**
    - `/health/ready` returns 200 `status:'ready'` even when degradable components (TMDB indexes) failed for lack of network. It returns 503 only for required dependencies.
    - Every non-`/health` route answers **503** `{status:'starting', message, components}` with `Retry-After` until boot finishes (`readiness.ts:106`). The adapter should treat that 503 as retryable.
17. **`installUrl` may use an alias** instead of the uuid when user aliases are enabled (`configApi.js:56-59`). Use the returned URL as it is, as the spec says.

## 4. Mocks

```ts
import { startMocks, mockEnv, AIOSTREAMS_MINIMAL_CONFIG } from '../mocks/index.ts';

const mocks = await startMocks(); // { aiostreamsUrl, aiometadataUrl, state, reset(), stop() }
Object.assign(process.env, mockEnv(mocks)); // AIOSTREAMS_*/AIOMETADATA_* for the manager
mocks.state.aiostreams.faults.inject({ status: 500 }); // next request only
mocks.state.aiometadata.faults.inject(
	{ hang: true },
	{ match: { pathPrefix: '/api/config/load' } }
);
mocks.state.aiostreams.faults.inject({ reset: true }, { times: 2 }); // ECONNRESET twice
mocks.state.aiostreams.faults.inject({ delayMs: 3000 }); // slow, then normal
mocks.state.aiostreams.rateLimit.enabled = true; // upstream defaults: user API 5/5s, create 10/h, login 5/5min
mocks.state.aiostreams.brokenPresetTypes.add('torrentio'); // that preset "fails its manifest fetch" -> 400
mocks.state.aiostreams.validationError = 'addon down'; // every create/update fails validation
mocks.state.aiometadata.ready = false; // readiness-gate 503s
await mocks.stop();
```

- Start `startAiostreamsMock({ authRequired: true })` to exercise the login path. The account is `manager` / `managerpass`, with admin rights.
- The AIOMetadata mock has `adminKey` `dev-admin-key` and `addonPassword` `dev-addon-password`; pass `null` to unset either. Its load limiter is on by default, as it is upstream. The AIOStreams limiters are off by default, as they are under the dev script.
- `state.*.users` exposes the stores. `state.*.requests` logs every request.
- `mocks.aiostreams.decrypt(segment)` decrypts a manifest URL segment.
- The mocks cover every route in section 7. They also cover the Stremio manifest routes, but only approximately.

Self-test: `pnpm vitest run --config tests/mocks/vitest.config.ts`.

- Every step of every flow must return the upstream status.
- The AIOMetadata responses must match the recorded real bodies structurally: same keys and types, and exact error strings.
- The same check against AIOStreams fixtures turns on once those fixtures are recorded.

The root `vite.config.ts` includes only `src/**`. To run `tests/**` specs from `pnpm vitest run`, add `tests/**/*.{test,spec}.ts` to its `include`.
