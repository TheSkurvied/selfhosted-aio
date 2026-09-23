/**
 * AIOStreams adapter (spec 7.1). All routes under /api/v1, responses wrapped as
 * {success, detail, data, error}. Config routes authenticate with Basic
 * uuid:rawPassword. When AIOSTREAMS_USERNAME is set, the adapter keeps a
 * session cookie (needed under AIOSTREAMS_AUTH_REQUIRED and for the dashboard)
 * and logs in again after a 401.
 */
import { randomToken } from '../crypto';
import { outgoing } from '../sync/strip';
import {
	codeForStatus,
	httpRequest,
	sanitize,
	SLOW_TIMEOUT_MS,
	UpstreamError,
	upstreamMessage,
	type HttpResult,
	type RequestOptions
} from './http';
import type { Config, CreateResult, HealthResult, RemoteUser, UpstreamAdapter } from './types';

export type AiostreamsOptions = {
	internalUrl: string;
	publicUrl: string;
	username?: string;
	password?: string;
};

type Envelope = { success?: boolean; data?: unknown; error?: { code?: string; message?: string } | null };

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export class AiostreamsAdapter implements UpstreamAdapter {
	readonly kind = 'aiostreams' as const;
	readonly publicUrl: string;
	private cookies = new Map<string, string>();
	private loginPromise: Promise<void> | null = null;

	constructor(private readonly o: AiostreamsOptions) {
		this.publicUrl = o.publicUrl.replace(/\/+$/, '');
	}

	get hasLogin(): boolean {
		return !!(this.o.username && this.o.password);
	}

	private scrubList(extra: Array<string | undefined | null> = []): string[] {
		return [this.o.password, ...extra].filter((s): s is string => !!s);
	}

	private cookieHeader(): string | undefined {
		if (this.cookies.size === 0) return undefined;
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	private storeCookies(headers: Headers) {
		const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
		for (const c of list) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			if (i <= 0) continue;
			const name = pair.slice(0, i).trim();
			const value = pair.slice(i + 1).trim();
			if (value === '' || /expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(name);
			else this.cookies.set(name, value);
		}
	}

	/** Log in with AIOSTREAMS_USERNAME/PASSWORD (single flight). */
	async login(): Promise<void> {
		if (!this.hasLogin) throw new UpstreamError('aiostreams', 'login', 'config', null, 'AIOSTREAMS_USERNAME/PASSWORD not configured');
		if (!this.loginPromise) {
			this.loginPromise = (async () => {
				this.cookies.clear();
				const r = await httpRequest({
					kind: 'aiostreams',
					op: 'login',
					baseUrl: this.o.internalUrl,
					method: 'POST',
					path: '/api/v1/auth/login',
					body: { username: this.o.username, password: this.o.password },
					scrub: this.scrubList()
				});
				if (r.status !== 200) {
					throw this.error('login', r, this.scrubList());
				}
				this.storeCookies(r.headers);
			})().finally(() => {
				this.loginPromise = null;
			});
		}
		return this.loginPromise;
	}

	private error(op: string, r: HttpResult, scrub: string[]): UpstreamError {
		const env = r.json as Envelope | undefined;
		let code = codeForStatus(r.status);
		// A wrong uuid or password is a 400 USER_INVALID_DETAILS upstream.
		if (env?.error?.code === 'USER_INVALID_DETAILS') code = 'not_found';
		if (env?.error?.code === 'USER_INVALID_CONFIG') code = 'invalid';
		return new UpstreamError('aiostreams', op, code, r.status, sanitize(`${r.status} ${upstreamMessage(r)}`, scrub));
	}

	/**
	 * Send a request with the session cookie attached (when configured). With
	 * `session: 'required'` it logs in first; on a 401 it logs in again and
	 * retries once.
	 */
	private async send(
		op: string,
		req: Omit<RequestOptions, 'kind' | 'op' | 'baseUrl'>,
		session: 'none' | 'optional' | 'required' = 'optional'
	): Promise<HttpResult> {
		const useSession = session !== 'none' && this.hasLogin;
		if (session === 'required' && !this.hasLogin) {
			throw new UpstreamError('aiostreams', op, 'config', null, 'needs AIOSTREAMS_USERNAME/PASSWORD');
		}
		if (useSession && this.cookies.size === 0 && session === 'required') await this.login();
		const run = () =>
			httpRequest({
				...req,
				kind: 'aiostreams',
				op,
				baseUrl: this.o.internalUrl,
				scrub: [...(req.scrub ?? []), ...this.scrubList()],
				headers: {
					...(req.headers ?? {}),
					...(useSession && this.cookieHeader() ? { cookie: this.cookieHeader()! } : {})
				}
			});
		let r = await run();
		if (useSession && r.status === 401) {
			await this.login();
			r = await run();
		}
		return r;
	}

	manifestUrl(uuid: string, manifestSecret?: string | null): string {
		if (!manifestSecret) throw new Error('AIOStreams manifest URL needs the encryptedPassword segment');
		return `${this.publicUrl}/stremio/${encodeURIComponent(uuid)}/${encodeURIComponent(manifestSecret)}/manifest.json`;
	}

	async create(config: Config): Promise<CreateResult> {
		const password = randomToken(32);
		const scrub = [password];
		const r = await this.send(
			'create',
			{ method: 'POST', path: '/api/v1/user', body: { config: outgoing('aiostreams', config), password }, timeoutMs: SLOW_TIMEOUT_MS, scrub },
			this.hasLogin ? 'required' : 'none'
		);
		if (r.status !== 201 && r.status !== 200) throw this.error('create', r, scrub);
		const data = (r.json as Envelope)?.data as { uuid?: string; encryptedPassword?: string } | null;
		if (!data?.uuid || !data.encryptedPassword) {
			throw new UpstreamError('aiostreams', 'create', 'protocol', r.status, 'response lacks uuid/encryptedPassword');
		}
		return {
			uuid: data.uuid,
			password,
			manifestSecret: data.encryptedPassword,
			manifestUrl: this.manifestUrl(data.uuid, data.encryptedPassword)
		};
	}

	/** Returns the config and the (fresh, random-IV) encryptedPassword segment. */
	async readWithSecret(uuid: string, password: string): Promise<{ config: Config; encryptedPassword?: string }> {
		const scrub = [password];
		const r = await this.send('read', {
			method: 'GET',
			path: '/api/v1/user',
			query: { raw: 'true' },
			headers: { authorization: `Basic ${b64(`${uuid}:${password}`)}` },
			scrub
		});
		if (r.status !== 200) throw this.error('read', r, scrub);
		const data = (r.json as Envelope)?.data as { userData?: Config; encryptedPassword?: string } | null;
		if (!data?.userData || typeof data.userData !== 'object') {
			throw new UpstreamError('aiostreams', 'read', 'protocol', r.status, 'response lacks userData');
		}
		return { config: data.userData, encryptedPassword: data.encryptedPassword };
	}

	async read(uuid: string, password: string): Promise<Config> {
		return (await this.readWithSecret(uuid, password)).config;
	}

	async update(uuid: string, password: string, config: Config): Promise<void> {
		const scrub = [password];
		const r = await this.send(
			'update',
			{
				method: 'PUT',
				path: '/api/v1/user',
				headers: { authorization: `Basic ${b64(`${uuid}:${password}`)}` },
				body: { config: outgoing('aiostreams', config) },
				timeoutMs: SLOW_TIMEOUT_MS,
				scrub
			},
			this.hasLogin ? 'required' : 'none'
		);
		if (r.status !== 200) throw this.error('update', r, scrub);
	}

	async exists(uuid: string): Promise<boolean> {
		const r = await this.send('exists', { method: 'HEAD', path: '/api/v1/user', query: { uuid } }, 'none');
		if (r.status === 200) return true;
		if (r.status === 400 || r.status === 404 || r.status === 401) return false;
		throw this.error('exists', r, []);
	}

	async delete(uuid: string, password?: string | null): Promise<void> {
		if (password) {
			const scrub = [password];
			const r = await this.send('delete', {
				method: 'DELETE',
				path: '/api/v1/user',
				headers: { authorization: `Basic ${b64(`${uuid}:${password}`)}` },
				scrub
			});
			if (r.status === 200) return;
			const err = this.error('delete', r, scrub);
			if (err.code !== 'not_found') throw err;
			// wrong password or gone: fall through to the admin route when we can
			if (!this.hasLogin) {
				if (await this.exists(uuid)) throw err;
				return;
			}
		}
		const r = await this.send(
			'delete',
			{ method: 'DELETE', path: `/api/v1/dashboard/users/${encodeURIComponent(uuid)}` },
			'required'
		);
		if (r.status === 200 || r.status === 404) return;
		throw this.error('delete', r, []);
	}

	async listRemote(): Promise<RemoteUser[]> {
		const out: RemoteUser[] = [];
		for (let page = 1; page < 1000; page++) {
			const r = await this.send(
				'list',
				{ method: 'GET', path: '/api/v1/dashboard/users', query: { page, limit: 200, sort: 'created_at', dir: 'asc' } },
				'required'
			);
			if (r.status !== 200) throw this.error('list', r, []);
			const data = (r.json as Envelope)?.data as {
				items?: Array<{ uuid: string; createdAt?: string; updatedAt?: string }>;
				pages?: number;
			} | null;
			const items = data?.items ?? [];
			for (const u of items) out.push({ uuid: u.uuid, createdAt: u.createdAt, lastUpdated: u.updatedAt });
			if (items.length === 0 || page >= (data?.pages ?? 1)) break;
		}
		return out;
	}

	async health(): Promise<HealthResult> {
		const checks: HealthResult['checks'] = [];
		let version: string | undefined;
		for (const path of ['/api/v1/health', '/api/v1/status']) {
			const started = Date.now();
			try {
				const r = await httpRequest({
					kind: 'aiostreams',
					op: 'health',
					baseUrl: this.o.internalUrl,
					method: 'GET',
					path,
					timeoutMs: 5000,
					retries429: 0
				});
				const ok = r.status === 200;
				if (path.endsWith('status') && ok) {
					const v = ((r.json as Envelope)?.data as { version?: string } | null)?.version;
					if (typeof v === 'string') version = v;
				}
				checks.push({ endpoint: path, ok, latencyMs: Date.now() - started, detail: ok ? undefined : `HTTP ${r.status}` });
			} catch (e) {
				checks.push({ endpoint: path, ok: false, latencyMs: Date.now() - started, detail: (e as Error).message });
			}
		}
		return { ok: checks.every((c) => c.ok), version, checks };
	}
}
