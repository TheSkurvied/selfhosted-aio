/* eslint-disable @typescript-eslint/no-explicit-any -- mocks handle arbitrary upstream JSON */
/**
 * In-memory AIOStreams mock (node:http, no deps). Behaviour follows
 * AIOStreams@b3bf75b source (the real server could not be built in the
 * sandbox, see README):
 *
 *   server/src/utils/responses.ts          {success, detail, data, error} envelope
 *   server/src/middlewares/errors.ts       APIError -> status + {code, message}
 *   core/src/utils/constants.ts:56         ErrorMap (status codes)
 *   server/src/routes/api/user.ts          HEAD/GET/POST/PUT/DELETE /api/v1/user
 *   server/src/utils/basic-auth.ts         Basic auth, encrypted password refused
 *   core/src/db/repositories/users.ts      create/update/delete, normalisation
 *   core/src/utils/auth.ts:410             config access key gate (AUTH_REQUIRED)
 *   server/src/middlewares/auth.ts         session cookie, injectAccessKey, requireAdmin
 *   server/src/routes/api/auth/index.ts    /auth/login, /auth/logout, /auth/me
 *   server/src/routes/api/dashboard/index.ts:731  /dashboard/users
 *   server/src/middlewares/ratelimit.ts    429 RATE_LIMIT_EXCEEDED
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { deflateSync, inflateSync } from 'node:zlib';
import {
	applyFault,
	close,
	FaultQueue,
	listen,
	RateLimiter,
	readCookie,
	readRequest,
	sendJson,
	sqliteNow,
	type Req
} from './http.ts';

// ---------------------------------------------------------------------------
// Error codes (core/src/utils/constants.ts:56)
// ---------------------------------------------------------------------------

const ERRORS = {
	MISSING_REQUIRED_FIELDS: [400, 'Required fields are missing'],
	USER_ALREADY_EXISTS: [409, 'User already exists'],
	USER_INVALID_DETAILS: [400, 'Invalid UUID or password'],
	USER_INVALID_CONFIG: [400, 'The config for this user is invalid'],
	USER_NEW_PASSWORD_TOO_SHORT: [400, 'New password is too short'],
	ADDON_PASSWORD_INVALID: [401, 'Invalid addon password'],
	PARENT_CONFIG_SELF_REFERENCE: [400, 'A config cannot inherit from itself'],
	PARENT_CONFIG_UNAVAILABLE: [400, 'The parent config could not be loaded'],
	DATABASE_ERROR: [500, 'A database error occurred'],
	ENCRYPTION_ERROR: [500, 'An error occurred in the encryption service'],
	INTERNAL_SERVER_ERROR: [500, 'An unexpected error occurred'],
	RATE_LIMIT_EXCEEDED: [429, 'Too many requests from this IP, please try again later.'],
	BAD_REQUEST: [400, 'Bad request'],
	UNAUTHORIZED: [401, 'Unauthorized'],
	FORBIDDEN: [403, 'Forbidden']
} as const satisfies Record<string, readonly [number, string]>;

export type AiostreamsErrorCode = keyof typeof ERRORS;

class ApiError extends Error {
	constructor(
		public code: AiostreamsErrorCode | 'NOT_FOUND',
		message?: string,
		public status: number = code === 'NOT_FOUND' ? 404 : ERRORS[code][0]
	) {
		super(message ?? (code === 'NOT_FOUND' ? 'Not Found' : ERRORS[code][1]));
	}
}

function envelope(
	success: boolean,
	opts: { detail?: string; data?: unknown; error?: { code: string; message: string } } = {}
) {
	return {
		success,
		detail: opts.detail || null,
		data: opts.data || null,
		error: opts.error || null
	};
}

// ---------------------------------------------------------------------------
// Crypto (core/src/utils/crypto.ts): same token format as upstream, so
// `isEncrypted` detection behaves identically.
// ---------------------------------------------------------------------------

const DEV_SECRET_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const toUrlSafe = (s: string) =>
	Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromUrlSafe(s: string): string {
	const pad = s.length % 4;
	const p = pad ? s + '='.repeat(4 - pad) : s;
	return Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function isEncrypted(data: string): boolean {
	try {
		const json = JSON.parse(fromUrlSafe(data));
		return ['aioEncrypt', 'a'].includes(json.type || json.t);
	} catch {
		return false;
	}
}

function encryptString(data: string, key: Buffer): string {
	const iv = randomBytes(16);
	const cipher = createCipheriv('aes-256-cbc', key, iv);
	const e = Buffer.concat([
		cipher.update(deflateSync(Buffer.from(data, 'utf8'), { level: 9 })),
		cipher.final()
	]);
	return toUrlSafe(JSON.stringify({ i: iv.toString('base64'), e: e.toString('base64'), t: 'a' }));
}

function decryptString(data: string, key: Buffer): string | null {
	try {
		if (!isEncrypted(data)) return null;
		const json = JSON.parse(fromUrlSafe(data));
		const d = createDecipheriv('aes-256-cbc', key, Buffer.from(json.iv || json.i, 'base64'));
		const out = Buffer.concat([
			d.update(Buffer.from(json.encrypted || json.e, 'base64')),
			d.final()
		]);
		return inflateSync(out).toString('utf8');
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Config validation / normalisation
// ---------------------------------------------------------------------------

/** Top-level keys of UserDataSchema (core/src/db/schemas.ts:739-1198). zod strips anything else. */
export const USER_DATA_KEYS = new Set(
	`uuid parentConfig variants healthChecks activeVariants autoVariants healthResults variantSelectorLocation encryptedPassword trusted showChanges manifestNotice linkedAccounts accessKey ip addonName addonLogo addonBackground addonDescription appliedTemplates excludedResolutions includedResolutions requiredResolutions preferredResolutions excludedQualities includedQualities requiredQualities preferredQualities excludedLanguages includedLanguages requiredLanguages preferredLanguages excludedSubtitles includedSubtitles requiredSubtitles preferredSubtitles excludedVisualTags includedVisualTags requiredVisualTags preferredVisualTags excludedAudioTags includedAudioTags requiredAudioTags preferredAudioTags excludedAudioChannels includedAudioChannels requiredAudioChannels preferredAudioChannels excludedStreamTypes includedStreamTypes requiredStreamTypes preferredStreamTypes excludedEncodes includedEncodes requiredEncodes preferredEncodes excludedRegexPatterns includedRegexPatterns requiredRegexPatterns preferredRegexPatterns syncedPreferredRegexUrls syncedExcludedRegexUrls syncedIncludedRegexUrls syncedRequiredRegexUrls syncedRankedRegexUrls syncedPreferredStreamExpressionUrls syncedExcludedStreamExpressionUrls syncedIncludedStreamExpressionUrls syncedRequiredStreamExpressionUrls syncedRankedStreamExpressionUrls excludedReleaseGroups includedReleaseGroups requiredReleaseGroups preferredReleaseGroups requiredKeywords includedKeywords excludedKeywords preferredKeywords excludeSeederRange includeSeederRange requiredSeederRange seederRangeTypes excludeAgeRange includeAgeRange requiredAgeRange ageRangeTypes digitalReleaseFilter enableSeadex excludeSeasonPacks excludeCached excludeCachedFromAddons excludeCachedFromServices excludeCachedFromStreamTypes excludeCachedMode excludeUncached excludeUncachedFromAddons excludeUncachedFromServices excludeUncachedFromStreamTypes excludeUncachedMode excludedStreamExpressions requiredStreamExpressions preferredStreamExpressions includedStreamExpressions rankedStreamExpressions rankedRegexPatterns regexOverrides selOverrides dynamicAddonFetching groups sortCriteria rpdbApiKey topPosterApiKey aioratingsApiKey aioratingsProfileId openposterdbApiKey openposterdbUrl openposterdbParameters posterService usePosterRedirectApi usePosterServiceForMeta formatter proxy resultLimits size bitrate hideErrors hideErrorsForResources statistics tmdbAccessToken tmdbApiKey tvdbApiKey pmdbApiKey yearMatching titleMatching seasonEpisodeMatching episodeTitleMatching languageInference deduplicator autoPlay areYouStillThere precacheNextEpisode alwaysPrecache precacheCondition precacheSelector precacheSingleStream preloadStreams services presets addonCategoryColors catalogModifications mergedCatalogs externalDownloads cacheAndPlay autoRemoveDownloads checkOwned failover serviceWrap jellyfin remuxDb`.split(
		' '
	)
);

const FORMATTERS = [
	'gdrive',
	'prism',
	'tamtaro',
	'lightgdrive',
	'minimalisticgdrive',
	'torrentio',
	'torbox',
	'custom'
];

/**
 * A reduced `validateConfig`: checks the required fields zod would, strips
 * unknown keys and applies the defaults upstream writes. Presets whose `type`
 * is in `brokenPresetTypes` fail like an unreachable addon manifest would.
 */
function validateConfig(input: any, state: AiostreamsMockState): Record<string, any> {
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw new Error('Expected object, received ' + typeof input);
	const issues: string[] = [];
	if (!input.formatter || typeof input.formatter !== 'object') issues.push('formatter: Required');
	else if (!FORMATTERS.includes(input.formatter.id))
		issues.push(
			`formatter.id: Invalid enum value. Expected ${FORMATTERS.map((f) => `'${f}'`).join(' | ')}`
		);
	if (!input.sortCriteria || typeof input.sortCriteria !== 'object')
		issues.push('sortCriteria: Required');
	else if (!Array.isArray(input.sortCriteria.global)) issues.push('sortCriteria.global: Required');
	if (!Array.isArray(input.presets)) issues.push('presets: Required');
	if (input.services !== undefined && !Array.isArray(input.services))
		issues.push('services: Expected array');
	if (issues.length) throw new Error(issues.join('; '));

	for (const p of input.presets as any[]) {
		if (state.brokenPresetTypes.has(p?.type)) {
			throw new Error(
				`Failed to fetch manifest for ${p.type}: Request failed with status code 502`
			);
		}
	}
	if (state.validationError) throw new Error(state.validationError);

	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(input))
		if (USER_DATA_KEYS.has(k) && v !== undefined) out[k] = v;
	if (out.checkOwned === undefined) out.checkOwned = true; // schemas.ts:1149 .default(true)
	out.proxy = out.proxy ?? {}; // config.ts:438 validateProxy always returns an object
	return out;
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

export interface AiostreamsUser {
	uuid: string;
	passwordHash: string;
	config: Record<string, any>;
	createdAt: string;
	updatedAt: string;
	accessedAt: string;
}

export interface AiostreamsMockOptions {
	port?: number;
	/** AIOSTREAMS_AUTH_REQUIRED: config writes need a login session. */
	authRequired?: boolean;
	/** AIOSTREAMS_AUTH as { username: password }. */
	accounts?: Record<string, string>;
	/** AIOSTREAMS_AUTH_PERMISSIONS as { username: permissions }. Unlisted users are admin. */
	permissions?: Record<string, string[]>;
	secretKeyHex?: string;
	baseUrl?: string;
}

export interface AiostreamsMockState {
	users: Map<string, AiostreamsUser>;
	authRequired: boolean;
	/** The config access key the server injects for logged-in users (CONFIG_ACCESS_KEY). */
	accessKey: string;
	accounts: Record<string, string>;
	permissions: Record<string, string[]>;
	sessions: Map<string, { username: string; permissions: string[]; expiresAt: number }>;
	/**
	 * Off by default (the dev script raises the limits too). When on, uses the
	 * upstream defaults: user API 5 per 5 s, user create 10 per hour, login 5 per 5 min.
	 */
	rateLimit: {
		enabled: boolean;
		userApi: { max: number; windowMs: number };
		userCreate: { max: number; windowMs: number };
		login: { max: number; windowMs: number };
	};
	/** Preset types whose "manifest fetch" fails during validation. */
	brokenPresetTypes: Set<string>;
	/** When set, every create/update fails validation with this message. */
	validationError: string | null;
	faults: FaultQueue;
	limiter: RateLimiter;
	requests: Array<{ method: string; path: string }>;
}

export interface AiostreamsMock {
	url: string;
	state: AiostreamsMockState;
	/** Decrypt an encryptedPassword segment (as found in manifest URLs). */
	decrypt(token: string): string | null;
	reset(): void;
	stop(): Promise<void>;
}

const ALL_PERMISSIONS = ['admin', 'proxy', 'service', 'sabnzbd', 'webdav', 'createConfig'];
const SESSION_COOKIE = 'aiostreams.session';
const SESSION_TTL_S = 86400;
const hashPassword = (p: string) => 'mock$' + createHash('sha256').update(p).digest('hex');

export async function startAiostreamsMock(
	opts: AiostreamsMockOptions = {}
): Promise<AiostreamsMock> {
	const key = Buffer.from(opts.secretKeyHex ?? DEV_SECRET_KEY, 'hex');
	const state: AiostreamsMockState = {
		users: new Map(),
		authRequired: opts.authRequired ?? false,
		accessKey: randomBytes(24).toString('hex'),
		accounts: opts.accounts ?? { manager: 'managerpass' },
		permissions: opts.permissions ?? { manager: ['admin'] },
		sessions: new Map(),
		rateLimit: {
			enabled: false,
			userApi: { max: 5, windowMs: 5_000 },
			userCreate: { max: 10, windowMs: 3_600_000 },
			login: { max: 5, windowMs: 300_000 }
		},
		brokenPresetTypes: new Set(),
		validationError: null,
		faults: new FaultQueue(),
		limiter: new RateLimiter(),
		requests: []
	};
	let baseUrl = opts.baseUrl ?? '';

	const permsOf = (username: string) => {
		const p = state.permissions[username];
		if (!p) return [...ALL_PERMISSIONS];
		return p.includes('admin') ? [...ALL_PERMISSIONS] : [...p];
	};

	function sessionOf(req: Req) {
		const token = readCookie(req, SESSION_COOKIE);
		if (!token) return null;
		const s = state.sessions.get(token);
		if (!s || s.expiresAt < Date.now()) return null;
		return s;
	}

	/** injectAccessKey + assertConfigAccessKey (auth.ts:187, core auth.ts:410). */
	function gateConfig(req: Req, config: any) {
		if (!state.authRequired) return;
		if (sessionOf(req) && config && typeof config === 'object') config.accessKey = state.accessKey;
		if (!config?.accessKey || config.accessKey !== state.accessKey)
			throw new ApiError('ADDON_PASSWORD_INVALID');
	}

	function rateLimit(req: Req, bucket: 'userApi' | 'userCreate' | 'login', res: Headers) {
		if (!state.rateLimit.enabled) return;
		const cfg = state.rateLimit[bucket];
		const ip = req.raw.socket.remoteAddress ?? '';
		const r = state.limiter.hit(`${bucket}:${ip}`, cfg.max, cfg.windowMs);
		res.set('ratelimit-policy', `${cfg.max};w=${Math.round(cfg.windowMs / 1000)}`);
		res.set('ratelimit-limit', String(cfg.max));
		res.set('ratelimit-remaining', String(r.remaining));
		res.set('ratelimit-reset', String(r.resetSec));
		if (r.limited) {
			res.set('retry-after', String(r.resetSec));
			throw new ApiError('RATE_LIMIT_EXCEEDED');
		}
	}

	/** parseBasicAuthHeader(req, { allowEncrypted: false }) */
	function basicAuth(req: Req): { uuid: string; password: string } | null {
		const header = req.headers.authorization;
		if (typeof header !== 'string' || header.length === 0) return null;
		if (!header.startsWith('Basic '))
			throw new ApiError('BAD_REQUEST', `Invalid Authorization header: expected 'Basic <base64>'`);
		const creds = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
		const i = creds.indexOf(':');
		if (i === -1)
			throw new ApiError('BAD_REQUEST', `Invalid basic auth format: expected 'uuid:password'`);
		const uuid = creds.slice(0, i);
		const password = creds.slice(i + 1);
		if (!uuid || !password)
			throw new ApiError('BAD_REQUEST', 'Missing username or password in basic auth');
		if (isEncrypted(password)) {
			throw new ApiError(
				'UNAUTHORIZED',
				'Encrypted password is not accepted here; use your raw password'
			);
		}
		return { uuid, password };
	}

	function requireBasic(req: Req) {
		const creds = basicAuth(req);
		if (!creds)
			throw new ApiError('MISSING_REQUIRED_FIELDS', 'Authorization header (Basic) is required');
		return creds;
	}

	function verified(uuid: string, password: string): AiostreamsUser {
		const u = state.users.get(uuid);
		if (!u || u.passwordHash !== hashPassword(password)) throw new ApiError('USER_INVALID_DETAILS');
		return u;
	}

	function validated(config: any): Record<string, any> {
		try {
			return validateConfig(config, state);
		} catch (e) {
			throw new ApiError('USER_INVALID_CONFIG', (e as Error).message);
		}
	}

	type Out = { status: number; body?: unknown; headers?: Record<string, string | string[]> };

	async function handle(req: Req, h: Headers): Promise<Out> {
		const { method, path } = req;
		const b = (req.body ?? {}) as Record<string, any>;
		if (req.bodyError) throw new ApiError('BAD_REQUEST', req.bodyError);

		if (path === '/api/v1/health' && method === 'GET') {
			return { status: 200, body: envelope(true, { detail: 'OK' }) };
		}
		if (path === '/api/v1/status' && method === 'GET') {
			return {
				status: 200,
				body: envelope(true, {
					data: {
						version: '2.34.1',
						tag: 'v2.34.1',
						channel: 'stable',
						commit: 'mock',
						buildTime: new Date(0).toISOString(),
						commitTime: new Date(0).toISOString(),
						users: null,
						settings: { baseUrl, addonName: 'AIOStreams', protected: state.authRequired }
					}
				})
			};
		}

		// --- /api/v1/user --------------------------------------------------------
		if (path === '/api/v1/user') {
			rateLimit(req, 'userApi', h);
			if (method === 'HEAD') {
				const uuid = req.query.get('uuid');
				if (typeof uuid !== 'string')
					throw new ApiError('MISSING_REQUIRED_FIELDS', 'uuid must be a string');
				if (!state.users.has(uuid)) throw new ApiError('USER_INVALID_DETAILS');
				return { status: 200, body: envelope(true, { detail: 'User exists', data: { uuid } }) };
			}
			if (method === 'GET') {
				const { uuid, password } = requireBasic(req);
				const u = verified(uuid, password);
				u.accessedAt = sqliteNow();
				const userData: Record<string, any> = JSON.parse(JSON.stringify(u.config));
				userData.trusted = false;
				userData.uuid = uuid;
				delete userData.ip;
				delete userData.activeVariants;
				delete userData.autoVariants;
				delete userData.healthResults;
				delete userData.variantSelectorLocation;
				delete userData.accessKey;
				return {
					status: 200,
					body: envelope(true, {
						detail: 'User details retrieved successfully',
						data: { userData, encryptedPassword: encryptString(password, key) }
					})
				};
			}
			if (method === 'POST') {
				rateLimit(req, 'userCreate', h);
				const { config, password } = b;
				if (!config || !password)
					throw new ApiError('MISSING_REQUIRED_FIELDS', 'config and password are required');
				const session = sessionOf(req);
				if (state.authRequired && session && !session.permissions.includes('createConfig')) {
					throw new ApiError('FORBIDDEN', 'Your account is not allowed to create configurations');
				}
				if (String(password).length < 6) throw new ApiError('USER_NEW_PASSWORD_TOO_SHORT');
				gateConfig(req, config);
				config.trusted = false;
				for (const k of [
					'ip',
					'activeVariants',
					'autoVariants',
					'healthResults',
					'variantSelectorLocation'
				])
					delete config[k];
				const stored = validated(config);
				const uuid = randomUUID();
				const now = sqliteNow();
				state.users.set(uuid, {
					uuid,
					passwordHash: hashPassword(password),
					config: stored,
					createdAt: now,
					updatedAt: now,
					accessedAt: now
				});
				return {
					status: 201,
					body: envelope(true, {
						detail: 'User was successfully created',
						data: { uuid, encryptedPassword: encryptString(password, key) }
					})
				};
			}
			if (method === 'PUT') {
				const { uuid, password } = requireBasic(req);
				const { config } = b;
				if (!config) throw new ApiError('MISSING_REQUIRED_FIELDS', 'config is required');
				config.uuid = uuid;
				if (config.parentConfig?.uuid === uuid) throw new ApiError('PARENT_CONFIG_SELF_REFERENCE');
				gateConfig(req, config);
				config.trusted = false;
				for (const k of [
					'ip',
					'activeVariants',
					'autoVariants',
					'healthResults',
					'variantSelectorLocation'
				])
					delete config[k];
				const u = verified(uuid, password);
				u.config = validated(config);
				u.updatedAt = sqliteNow();
				// updateUser returns void, so `userData` is undefined and drops out of the JSON.
				return {
					status: 200,
					body: envelope(true, { detail: 'User updated successfully', data: { uuid } })
				};
			}
			if (method === 'DELETE') {
				const { uuid, password } = requireBasic(req);
				verified(uuid, password);
				state.users.delete(uuid);
				return { status: 200, body: envelope(true, { detail: 'User deleted successfully' }) };
			}
		}

		// --- /api/v1/auth ----------------------------------------------------------
		if (path === '/api/v1/auth/login' && method === 'POST') {
			rateLimit(req, 'login', h);
			const { username, password } = b;
			if (typeof username !== 'string' || typeof password !== 'string') {
				throw new ApiError('MISSING_REQUIRED_FIELDS', 'username and password are required');
			}
			if (state.accounts[username] === undefined || state.accounts[username] !== password) {
				throw new ApiError('UNAUTHORIZED', 'Invalid username or password');
			}
			const permissions = permsOf(username);
			const token = randomBytes(32).toString('base64url');
			state.sessions.set(token, {
				username,
				permissions,
				expiresAt: Date.now() + SESSION_TTL_S * 1000
			});
			const expires = new Date(Date.now() + SESSION_TTL_S * 1000).toUTCString();
			return {
				status: 200,
				headers: {
					'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_S}; Path=/; Expires=${expires}; HttpOnly; SameSite=Strict`
				},
				body: envelope(true, {
					detail: 'Logged in successfully',
					data: {
						username,
						isAdmin: permissions.includes('admin'),
						permissions,
						source: 'password'
					}
				})
			};
		}
		if (path === '/api/v1/auth/logout' && method === 'POST') {
			const token = readCookie(req, SESSION_COOKIE);
			if (token) state.sessions.delete(token);
			return {
				status: 200,
				headers: {
					'set-cookie': `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
				},
				body: envelope(true, { detail: 'Logged out successfully' })
			};
		}
		if (path === '/api/v1/auth/me' && method === 'GET') {
			const s = sessionOf(req);
			if (!s) throw new ApiError('UNAUTHORIZED');
			return {
				status: 200,
				body: envelope(true, {
					data: {
						username: s.username,
						isAdmin: s.permissions.includes('admin'),
						permissions: s.permissions,
						source: 'password'
					}
				})
			};
		}

		// --- /api/v1/dashboard/users (requireAdmin) --------------------------------
		if (path.startsWith('/api/v1/dashboard/')) {
			const s = sessionOf(req);
			const wantsHtml = prefersHtml(req.headers.accept);
			if (!s) {
				if (wantsHtml)
					return { status: 302, headers: { location: `/login?next=${encodeURIComponent(path)}` } };
				throw new ApiError('UNAUTHORIZED');
			}
			if (!s.permissions.includes('admin')) {
				if (wantsHtml) return { status: 302, headers: { location: '/' } };
				throw new ApiError('FORBIDDEN');
			}
			if (path === '/api/v1/dashboard/users' && method === 'GET') {
				const limit = Math.min(Math.max(Number(req.query.get('limit')) || 25, 1), 200);
				const page = Math.max(Number(req.query.get('page')) || 1, 1);
				const q = req.query.get('q')?.trim() || undefined;
				const dir = req.query.get('dir') === 'asc' ? 1 : -1;
				const sortKey =
					(
						{ created_at: 'createdAt', accessed_at: 'accessedAt', updated_at: 'updatedAt' } as const
					)[(req.query.get('sort') ?? 'created_at') as 'created_at'] ?? 'createdAt';
				const all = [...state.users.values()]
					.filter((u) => !q || u.uuid.includes(q))
					.sort((a, b2) => (a[sortKey] < b2[sortKey] ? -dir : a[sortKey] > b2[sortKey] ? dir : 0));
				const items = all.slice((page - 1) * limit, page * limit).map((u) => ({
					uuid: u.uuid,
					createdAt: utc(u.createdAt),
					updatedAt: utc(u.updatedAt),
					accessedAt: utc(u.accessedAt),
					requests24h: 0
				}));
				return {
					status: 200,
					body: envelope(true, {
						data: { items, total: all.length, page, limit, pages: Math.ceil(all.length / limit) }
					})
				};
			}
			const m = /^\/api\/v1\/dashboard\/users\/([^/]+)$/.exec(path);
			if (m && method === 'GET') {
				const u = state.users.get(decodeURIComponent(m[1]));
				if (!u)
					return {
						status: 404,
						body: envelope(false, { error: { code: 'NOT_FOUND', message: 'User not found' } })
					};
				return {
					status: 200,
					body: envelope(true, {
						data: {
							uuid: u.uuid,
							createdAt: utc(u.createdAt),
							updatedAt: utc(u.updatedAt),
							accessedAt: utc(u.accessedAt),
							requests24h: 0,
							recentErrorStages: []
						}
					})
				};
			}
			if (m && method === 'DELETE') {
				const ok = state.users.delete(decodeURIComponent(m[1]));
				return ok
					? { status: 200, body: envelope(true, { data: { deleted: true } }) }
					: {
							status: 404,
							body: envelope(false, { error: { code: 'NOT_FOUND', message: 'User not found' } })
						};
			}
		}

		// --- Stremio manifest (approximation) ---------------------------------------
		const mm = /^\/stremio\/([^/]+)\/([^/]+)\/manifest\.json$/.exec(path);
		if (mm && method === 'GET') {
			const password = decryptString(decodeURIComponent(mm[2]), key);
			const u = state.users.get(mm[1]);
			if (!password || !u || u.passwordHash !== hashPassword(password))
				throw new ApiError('USER_INVALID_DETAILS');
			return {
				status: 200,
				body: {
					id: 'com.aiostreams.viren070',
					version: '2.34.1',
					name: u.config.addonName ?? 'AIOStreams',
					resources: ['stream'],
					types: ['movie', 'series'],
					catalogs: [],
					behaviorHints: { configurable: true }
				}
			};
		}

		if (path.startsWith('/api/v1/'))
			return { status: 404, body: envelope(false, { detail: 'Not Found' }) };
		return { status: 404, body: `Cannot ${method} ${path}` };
	}

	const server: Server = createServer(async (rawReq, res) => {
		const h = new Headers();
		try {
			const req = await readRequest(rawReq);
			state.requests.push({ method: req.method, path: req.path });
			if (await applyFault(state.faults.take(req.method, req.path), res)) return;
			const out = await handle(req, h);
			const headers: Record<string, string | string[]> = {
				...Object.fromEntries(h),
				...(out.headers ?? {})
			};
			if (out.status === 302) {
				res.writeHead(302, headers);
				res.end();
				return;
			}
			sendJson(res, out.status, out.body, headers);
		} catch (e) {
			const err = e instanceof ApiError ? e : new ApiError('INTERNAL_SERVER_ERROR');
			sendJson(
				res,
				err.status,
				envelope(false, { error: { code: err.code, message: err.message } }),
				Object.fromEntries(h)
			);
		}
	});

	const url = await listen(server, opts.port);
	if (!baseUrl) baseUrl = url;

	return {
		url,
		state,
		decrypt: (t) => decryptString(t, key),
		reset() {
			state.users.clear();
			state.sessions.clear();
			state.faults.clear();
			state.limiter.reset();
			state.brokenPresetTypes.clear();
			state.validationError = null;
			state.requests.length = 0;
		},
		stop: () => close(server)
	};
}

function utc(sqlite: string): string {
	return sqlite.replace(' ', 'T') + 'Z';
}

/** Express `req.accepts(['html', 'json']) === 'html'`: html wins unless json is preferred or html absent. */
function prefersHtml(accept: string | undefined): boolean {
	if (!accept) return true;
	const types = accept.split(',').map((p, i) => {
		const [t, ...params] = p.trim().split(';');
		const q = Number(params.find((x) => x.trim().startsWith('q='))?.split('=')[1] ?? 1);
		return { t: t.trim().toLowerCase(), q, i };
	});
	const score = (want: string) => {
		const [maj] = want.split('/');
		const hit = types
			.filter((x) => x.t === want || x.t === `${maj}/*` || x.t === '*/*')
			.sort((a, b) => b.q - a.q || a.i - b.i)[0];
		return hit && hit.q > 0 ? hit : null;
	};
	const html = score('text/html');
	const json = score('application/json');
	if (!html) return false;
	if (!json) return true;
	return html.q > json.q || (html.q === json.q && html.i <= json.i);
}
