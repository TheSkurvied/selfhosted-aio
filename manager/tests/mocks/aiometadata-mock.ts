/**
 * In-memory AIOMetadata mock (node:http, no deps). Mirrors the real routes the
 * manager uses; behaviour is taken from aiometadata@7ef886c and checked against
 * tests/mocks/fixtures/aiometadata.json.
 *
 *   addon/index.ts:176-215        /health/live, /health/ready
 *   addon/index.ts:6632           /api/config/addon-info
 *   addon/lib/configApi.js:253    saveConfig     (POST /api/config/save)
 *   addon/lib/configApi.js:581    loadConfig     (POST /api/config/load/:uuid, own rate limit index.ts:340)
 *   addon/lib/configApi.js:653    updateConfig   (PUT  /api/config/update/:uuid)
 *   addon/index.ts:6654-6784      admin list/export/detail/reset-password/delete (x-admin-key)
 *   addon/index.ts:6839           DELETE /api/config/delete-user/:uuid
 *   addon/lib/database.ts:541     saveUserConfig adds configHash
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { applyFault, close, FaultQueue, listen, RateLimiter, readRequest, sendJson, sqliteNow, type Req } from './http.ts';

export interface AiometadataUser {
	uuid: string;
	passwordHash: string;
	config: Record<string, any>;
	createdAt: string;
	updatedAt: string;
}

export interface AiometadataMockOptions {
	port?: number;
	/** HOST_NAME; defaults to the mock's own base URL. */
	hostName?: string;
	/** ADMIN_KEY; null means unset (every admin call is 401). */
	adminKey?: string | null;
	/** ADDON_PASSWORD; null means unset (no addon password check). */
	addonPassword?: string | null;
	/** BUILT_IN_TMDB_API_KEY is set, so apiKeys.tmdb becomes optional. */
	builtInTmdbKey?: boolean;
}

export interface AiometadataMockState {
	users: Map<string, AiometadataUser>;
	trusted: Set<string>;
	adminKey: string | null;
	addonPassword: string | null;
	builtInTmdbKey: boolean;
	/** The load limiter is on by default, as upstream (20 per uuid per minute). */
	rateLimit: { enabled: boolean; loadPerMinute: number };
	faults: FaultQueue;
	limiter: RateLimiter;
	/** Every request seen, oldest first (method + path). */
	requests: Array<{ method: string; path: string }>;
}

export interface AiometadataMock {
	url: string;
	state: AiometadataMockState;
	/** Plain password for tests that want to read a config the "upstream" way. */
	hashPassword(p: string): string;
	reset(): void;
	stop(): Promise<void>;
}

const VERSION = '3.0.0';
const hashPassword = (p: string) => 'mock$' + createHash('sha256').update(p).digest('hex');

function configHashOf(config: Record<string, any>): string {
	const forHash = { ...config };
	delete forHash.configHash;
	return createHash('md5').update(JSON.stringify(forHash)).digest('hex').substring(0, 16);
}

function missingRequiredKeys(config: any, builtInTmdb: boolean): string[] {
	const required = ['tmdb'];
	const art = config?.artProviders;
	const fanart =
		!!art &&
		['movie', 'series', 'anime'].some((t) => {
			const p = art[t];
			if (typeof p === 'string') return p === 'fanart';
			if (p && typeof p === 'object') return p.poster === 'fanart' || p.background === 'fanart' || p.logo === 'fanart';
			return false;
		});
	if (fanart) required.push('fanart');
	return required.filter((k) => {
		if (k === 'tmdb') return !(typeof config?.apiKeys?.tmdb === 'string' && config.apiKeys.tmdb.trim()) && !builtInTmdb;
		return !config?.apiKeys?.[k] || String(config.apiKeys[k]).trim() === '';
	});
}

export async function startAiometadataMock(opts: AiometadataMockOptions = {}): Promise<AiometadataMock> {
	const state: AiometadataMockState = {
		users: new Map(),
		trusted: new Set(),
		adminKey: opts.adminKey === undefined ? 'dev-admin-key' : opts.adminKey,
		addonPassword: opts.addonPassword === undefined ? 'dev-addon-password' : opts.addonPassword,
		builtInTmdbKey: opts.builtInTmdbKey ?? false,
		rateLimit: { enabled: true, loadPerMinute: 20 },
		faults: new FaultQueue(),
		limiter: new RateLimiter(),
		requests: []
	};
	let hostName = opts.hostName ?? '';

	const installUrl = (uuid: string) => `${hostName}/stremio/${uuid}/manifest.json`;

	function saveUserConfig(uuid: string, passwordHash: string, config: Record<string, any>) {
		const stored = { ...config, configHash: configHashOf(config) };
		const now = sqliteNow();
		const existing = state.users.get(uuid);
		state.users.set(uuid, {
			uuid,
			passwordHash,
			config: stored,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		});
	}

	function verify(uuid: string, password: string): AiometadataUser | null {
		const u = state.users.get(uuid);
		return u && u.passwordHash === hashPassword(password) ? u : null;
	}

	function addonPasswordOk(given: unknown): boolean {
		return !state.addonPassword || given === state.addonPassword;
	}

	function requireAdmin(req: Req): { status: number; body: unknown } | null {
		if (!state.adminKey) {
			return {
				status: 401,
				body: {
					error: 'Unauthorized',
					message:
						'ADMIN_KEY environment variable must be configured to access the dashboard, or configure an identity provider to sign in without one.'
				}
			};
		}
		if (req.headers['x-admin-key'] !== state.adminKey) return { status: 401, body: { error: 'Unauthorized' } };
		return null;
	}

	const INVALID_ADDON = { error: 'Invalid addon password. Contact the addon administrator.' };

	async function handle(req: Req): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
		const { method, path } = req;
		const b = (req.body ?? {}) as Record<string, any>;

		if (method === 'GET' && path === '/health/live') {
			return { status: 200, body: { status: 'alive', timestamp: new Date().toISOString(), version: VERSION } };
		}
		if (method === 'GET' && path === '/health/ready') {
			const c = (kind: string) => ({ kind, state: 'ready' });
			return {
				status: 200,
				body: {
					status: 'ready',
					ready: true,
					components: {
						database: c('required'),
						settings: c('required'),
						redis: c('required'),
						idMapper: c('degradable'),
						animeListMapper: c('degradable'),
						wikiMappings: c('degradable'),
						imdbRatings: c('degradable'),
						tmdbNetworkIndex: c('degradable'),
						tmdbKeywordIndex: c('degradable'),
						cacheCleanup: c('degradable'),
						flixpatrolIndex: c('degradable'),
						cacheWarming: c('deferred')
					},
					dependencies: { redis: { state: 'ok', latencyMs: 0 }, database: { state: 'ok', latencyMs: 0 } },
					counters: {
						errorsTotal: 0,
						errorsToday: 0,
						cache: { hits: 0, misses: 0, errors: 0, corruptedEntries: 0, hitRate: '0.00', errorRate: '0.00' }
					},
					timestamp: new Date().toISOString(),
					version: VERSION
				}
			};
		}
		if (method === 'GET' && path === '/api/config/addon-info') {
			return { status: 200, body: { requiresAddonPassword: !!state.addonPassword, addonVersion: VERSION } };
		}

		// --- config API -------------------------------------------------------
		if (method === 'POST' && path === '/api/config/save') {
			if (req.body === undefined || typeof req.body !== 'object' || req.body === null) {
				return { status: 400, body: { error: 'Invalid request body. Expected JSON.' } };
			}
			const { config, password, userUUID: existingUUID, addonPassword } = b;
			if (!config) return { status: 400, body: { error: 'Configuration data is required' } };
			if (!password) return { status: 400, body: { error: 'Password is required' } };
			if (!addonPasswordOk(addonPassword)) return { status: 401, body: INVALID_ADDON };
			const missing = missingRequiredKeys(config, state.builtInTmdbKey);
			if (missing.length) {
				return { status: 400, body: { error: `Missing required API keys: ${missing.join(', ')}`, missingKeys: missing } };
			}
			const uuid: string = existingUUID || randomUUID();
			const withTs: Record<string, any> = { ...config, lastModified: Date.now() };
			withTs.configVersion = Date.now();
			saveUserConfig(uuid, hashPassword(password), withTs);
			state.trusted.add(uuid);
			return {
				status: 200,
				body: {
					success: true,
					userUUID: uuid,
					installUrl: installUrl(uuid),
					message: existingUUID ? 'Configuration updated successfully' : 'Configuration saved successfully'
				}
			};
		}

		let m = /^\/api\/config\/load\/([^/]+)$/.exec(path);
		if (method === 'POST' && m) {
			const uuid = decodeURIComponent(m[1]);
			if (state.rateLimit.enabled) {
				const bucket = Math.floor(Date.now() / 60000);
				const r = state.limiter.hit(`config-load:${uuid}:${bucket}`, state.rateLimit.loadPerMinute, 70_000);
				if (r.limited) return { status: 429, body: { error: 'Too many login attempts. Please try again shortly.' } };
			}
			const { password, addonPassword } = b;
			if (!password) return { status: 400, body: { error: 'Password is required' } };
			const isTrusted = state.trusted.has(uuid);
			if (!isTrusted && state.addonPassword && addonPassword !== state.addonPassword) {
				return { status: 401, body: INVALID_ADDON };
			}
			const user = verify(uuid, password);
			if (!user) return { status: 401, body: { error: 'Invalid UUID or password' } };
			if (!isTrusted && addonPassword && addonPassword === state.addonPassword) state.trusted.add(uuid);
			// Upstream spreads apiKeys and sets customDescriptionBlurb to undefined, so
			// the response always has an apiKeys object, minus that one key.
			const cfg = JSON.parse(JSON.stringify(user.config));
			const out = { ...cfg, apiKeys: { ...cfg.apiKeys, customDescriptionBlurb: undefined } };
			return { status: 200, body: { success: true, userUUID: uuid, installUrl: installUrl(uuid), config: out } };
		}

		m = /^\/api\/config\/update\/([^/]+)$/.exec(path);
		if (method === 'PUT' && m) {
			const uuid = decodeURIComponent(m[1]);
			const { config, password, addonPassword } = b;
			if (!password) return { status: 400, body: { error: 'Password is required' } };
			if (!config) return { status: 400, body: { error: 'Configuration data is required' } };
			if (!state.trusted.has(uuid) && state.addonPassword && addonPassword !== state.addonPassword) {
				return { status: 401, body: INVALID_ADDON };
			}
			const missing = missingRequiredKeys(config, state.builtInTmdbKey);
			if (missing.length) {
				return { status: 400, body: { error: `Missing required API keys: ${missing.join(', ')}`, missingKeys: missing } };
			}
			if (!verify(uuid, password)) return { status: 401, body: { error: 'Invalid UUID or password' } };
			const now = Date.now();
			saveUserConfig(uuid, hashPassword(password), { ...config, lastModified: now, configVersion: now + 1 });
			return {
				status: 200,
				body: { success: true, userUUID: uuid, installUrl: installUrl(uuid), message: 'Configuration updated successfully' }
			};
		}

		m = /^\/api\/config\/delete-user\/([^/]+)$/.exec(path);
		if (method === 'DELETE' && m) {
			const uuid = decodeURIComponent(m[1]);
			const { password } = b;
			if (!uuid || !password) return { status: 400, body: { error: 'User UUID and password are required' } };
			if (!state.users.has(uuid)) return { status: 404, body: { error: 'User not found' } };
			if (!verify(uuid, password)) return { status: 401, body: { error: 'Invalid password' } };
			if (state.addonPassword && b.addonPassword !== state.addonPassword) {
				return { status: 401, body: { error: 'Invalid addon password' } };
			}
			state.users.delete(uuid);
			state.trusted.delete(uuid);
			return {
				status: 200,
				body: { success: true, message: 'User account and all associated data have been permanently deleted' }
			};
		}

		// --- admin API ----------------------------------------------------------
		if (path.startsWith('/api/admin/users')) {
			const denied = requireAdmin(req);
			if (denied) return denied;

			if (method === 'GET' && path === '/api/admin/users') {
				const limitN = parseInt(req.query.get('limit') ?? '', 10);
				const offsetN = parseInt(req.query.get('offset') ?? '', 10);
				const limit = Math.max(1, Math.min(500, Number.isFinite(limitN) ? limitN : 100));
				const offset = Math.max(0, Number.isFinite(offsetN) ? offsetN : 0);
				const q = String(req.query.get('q') ?? '').trim().toLowerCase();
				const all = sortedUsers().filter((u) => !q || u.uuid.startsWith(q));
				const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
				return {
					status: 200,
					body: {
						total: all.length,
						users: all.slice(offset, offset + limit).map((u) => {
							const k = u.config.apiKeys ?? null;
							return {
								uuid: u.uuid,
								alias: null,
								created_at: u.createdAt,
								last_updated: u.updatedAt,
								last_activity: null,
								total_requests: 0,
								has_api_keys: Boolean(k && (k.tmdb || k.tvdb || k.imdb || k.kitsu)),
								config_status: 'configured',
								is_active: Date.parse(u.updatedAt.replace(' ', 'T') + 'Z') >= weekAgo
							};
						})
					}
				};
			}
			if (method === 'GET' && path === '/api/admin/users/export') {
				const date = new Date().toISOString();
				const users = sortedUsers();
				return {
					status: 200,
					headers: { 'content-disposition': `attachment; filename=users-export-${date.split('T')[0]}.json` },
					body: {
						exportDate: date,
						totalUsers: users.length,
						users: users.map((u) => ({ uuid: u.uuid, created_at: u.createdAt, updated_at: u.updatedAt, config: u.config }))
					}
				};
			}
			m = /^\/api\/admin\/users\/([^/]+)\/reset-password$/.exec(path);
			if (method === 'POST' && m) {
				const u = state.users.get(decodeURIComponent(m[1]));
				if (!u) return { status: 404, body: { error: 'User not found' } };
				const pw = b.newPassword || randomBytes(6).toString('base64url').slice(0, 8);
				u.passwordHash = hashPassword(pw);
				u.updatedAt = sqliteNow();
				return { status: 200, body: { success: true } };
			}
			m = /^\/api\/admin\/users\/([^/]+)$/.exec(path);
			if (m && method === 'GET') {
				const u = state.users.get(decodeURIComponent(m[1]));
				if (!u) return { status: 404, body: { error: 'User not found' } };
				const c = u.config;
				return {
					status: 200,
					body: {
						user: {
							uuid: u.uuid,
							created_at: u.createdAt,
							last_updated: u.updatedAt,
							last_activity: null,
							total_requests: 0,
							api_keys: {
								tmdb: !!c?.apiKeys?.tmdb,
								tvdb: !!c?.apiKeys?.tvdb,
								imdb: !!c?.apiKeys?.imdb,
								kitsu: !!c?.apiKeys?.kitsu
							},
							streaming_services: c?.streaming || [],
							catalogs_count: c?.catalogs?.length || 0,
							language: c?.language || 'en-US',
							region: c?.region || 'US'
						}
					}
				};
			}
			if (m && method === 'DELETE') {
				const uuid = decodeURIComponent(m[1]);
				const existed = state.users.delete(uuid);
				state.trusted.delete(uuid);
				if (!existed) return { status: 404, body: { error: 'User not found' } };
				return { status: 200, body: { success: true, message: 'User deleted successfully' } };
			}
		}

		// --- manifest (approximation: the real one lists catalogs per config) ---
		m = /^\/stremio\/([^/]+)\/manifest\.json$/.exec(path);
		if (method === 'GET' && m) {
			const u = state.users.get(decodeURIComponent(m[1]));
			if (!u) return { status: 404, body: { error: 'User not found' } };
			return {
				status: 200,
				body: {
					id: 'aio-metadata',
					version: VERSION,
					name: 'AIOMetadata',
					resources: ['catalog', 'meta'],
					types: ['movie', 'series'],
					catalogs: [],
					behaviorHints: { configurable: true }
				}
			};
		}

		return { status: 404, body: { error: `Cannot ${method} ${path}` } };
	}

	function sortedUsers(): AiometadataUser[] {
		// ORDER BY created_at DESC; ties keep newest insert first.
		return [...state.users.values()].reverse().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
	}

	const server: Server = createServer(async (rawReq, res) => {
		try {
			const req = await readRequest(rawReq);
			state.requests.push({ method: req.method, path: req.path });
			if (await applyFault(state.faults.take(req.method, req.path), res)) return;
			if (req.bodyError) {
				sendJson(res, 400, { error: 'Invalid JSON body' });
				return;
			}
			const out = await handle(req);
			sendJson(res, out.status, out.body, out.headers);
		} catch (e) {
			sendJson(res, 500, { error: (e as Error).message });
		}
	});

	const url = await listen(server, opts.port);
	if (!hostName) hostName = url;

	return {
		url,
		state,
		hashPassword,
		reset() {
			state.users.clear();
			state.trusted.clear();
			state.faults.clear();
			state.limiter.reset();
			state.requests.length = 0;
		},
		stop: () => close(server)
	};
}
