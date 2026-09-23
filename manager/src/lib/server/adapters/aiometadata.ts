/**
 * AIOMetadata adapter (spec 7.2). Config routes carry the per-config password
 * and ADDON_PASSWORD in the body; admin routes carry `x-admin-key`.
 * `save` is only used to create (it upserts without a password check when
 * given a userUUID, which we never send); changes always go through `update`.
 */
import { randomToken } from '../crypto';
import { outgoing } from '../sync/strip';
import {
	codeForStatus,
	httpRequest,
	sanitize,
	UpstreamError,
	upstreamMessage,
	type HttpResult,
	type RequestOptions
} from './http';
import type { Config, CreateResult, HealthResult, RemoteUser, UpstreamAdapter } from './types';

export type AiometadataOptions = {
	internalUrl: string;
	publicUrl: string;
	adminKey: string;
	addonPassword?: string;
};

export type AiometadataAdminUser = {
	uuid: string;
	created_at?: string;
	last_updated?: string;
	is_active?: boolean;
	[k: string]: unknown;
};

export class AiometadataAdapter implements UpstreamAdapter {
	readonly kind = 'aiometadata' as const;
	readonly publicUrl: string;

	constructor(private readonly o: AiometadataOptions) {
		this.publicUrl = o.publicUrl.replace(/\/+$/, '');
	}

	private scrubList(extra: Array<string | undefined | null> = []): string[] {
		return [this.o.adminKey, this.o.addonPassword, ...extra].filter((s): s is string => !!s);
	}

	private req(op: string, r: Omit<RequestOptions, 'kind' | 'op' | 'baseUrl'>, extraScrub: string[] = []) {
		return httpRequest({
			...r,
			kind: 'aiometadata',
			op,
			baseUrl: this.o.internalUrl,
			scrub: this.scrubList(extraScrub)
		});
	}

	private admin(op: string, r: Omit<RequestOptions, 'kind' | 'op' | 'baseUrl'>) {
		return this.req(op, { ...r, headers: { ...(r.headers ?? {}), 'x-admin-key': this.o.adminKey } });
	}

	private error(op: string, r: HttpResult, scrub: string[] = []): UpstreamError {
		const msg = upstreamMessage(r);
		let code = codeForStatus(r.status);
		// A bad ADDON_PASSWORD is a manager configuration problem, not a missing config.
		if (r.status === 401 && /addon password/i.test(msg)) code = 'config';
		// Missing API keys etc. are validation problems.
		if (r.status === 400) code = 'invalid';
		return new UpstreamError('aiometadata', op, code, r.status, sanitize(`${r.status} ${msg}`, this.scrubList(scrub)));
	}

	manifestUrl(uuid: string): string {
		return `${this.publicUrl}/stremio/${encodeURIComponent(uuid)}/manifest.json`;
	}

	async create(config: Config): Promise<CreateResult> {
		const password = randomToken(32);
		const r = await this.req(
			'create',
			{
				method: 'POST',
				path: '/api/config/save',
				body: { config: outgoing('aiometadata', config), password, addonPassword: this.o.addonPassword ?? '' },
				timeoutMs: 60_000
			},
			[password]
		);
		const j = r.json as { success?: boolean; userUUID?: string } | undefined;
		if (r.status !== 200 || !j?.success || !j.userUUID) throw this.error('create', r, [password]);
		return { uuid: j.userUUID, password, manifestUrl: this.manifestUrl(j.userUUID) };
	}

	async read(uuid: string, password: string): Promise<Config> {
		const r = await this.req(
			'read',
			{
				method: 'POST',
				path: `/api/config/load/${encodeURIComponent(uuid)}`,
				body: { password, addonPassword: this.o.addonPassword ?? '' }
			},
			[password]
		);
		const j = r.json as { success?: boolean; config?: Config } | undefined;
		if (r.status !== 200 || !j?.config || typeof j.config !== 'object') {
			if (r.status === 200) throw new UpstreamError('aiometadata', 'read', 'protocol', 200, 'response lacks config');
			throw this.error('read', r, [password]);
		}
		return j.config;
	}

	async update(uuid: string, password: string, config: Config): Promise<void> {
		const r = await this.req(
			'update',
			{
				method: 'PUT',
				path: `/api/config/update/${encodeURIComponent(uuid)}`,
				body: { config: outgoing('aiometadata', config), password, addonPassword: this.o.addonPassword ?? '' },
				timeoutMs: 60_000
			},
			[password]
		);
		if (r.status !== 200) throw this.error('update', r, [password]);
	}

	/** Admin delete: works without the config password. Idempotent. */
	async delete(uuid: string): Promise<void> {
		const r = await this.admin('delete', { method: 'DELETE', path: `/api/admin/users/${encodeURIComponent(uuid)}` });
		if (r.status === 200 || r.status === 404) return;
		throw this.error('delete', r);
	}

	async adminList(): Promise<AiometadataAdminUser[]> {
		const out: AiometadataAdminUser[] = [];
		const limit = 500;
		for (let offset = 0; offset < 1_000_000; offset += limit) {
			const r = await this.admin('list', { method: 'GET', path: '/api/admin/users', query: { limit, offset } });
			if (r.status !== 200) throw this.error('list', r);
			const j = r.json as { users?: AiometadataAdminUser[]; total?: number } | undefined;
			const users = j?.users ?? [];
			out.push(...users);
			if (users.length < limit || out.length >= (j?.total ?? 0)) break;
		}
		return out;
	}

	async listRemote(): Promise<RemoteUser[]> {
		return (await this.adminList()).map((u) => ({ uuid: u.uuid, createdAt: u.created_at, lastUpdated: u.last_updated }));
	}

	async adminDetail(uuid: string): Promise<Record<string, unknown>> {
		const r = await this.admin('detail', { method: 'GET', path: `/api/admin/users/${encodeURIComponent(uuid)}` });
		if (r.status !== 200) throw this.error('detail', r);
		return ((r.json as { user?: Record<string, unknown> })?.user ?? {}) as Record<string, unknown>;
	}

	/** Full export. Contains plain-text keys: never log or return it. */
	async adminExport(): Promise<Array<{ uuid: string; config: Config }>> {
		const r = await this.admin('export', { method: 'GET', path: '/api/admin/users/export', timeoutMs: 60_000 });
		if (r.status !== 200) throw this.error('export', r);
		return ((r.json as { users?: Array<{ uuid: string; config: Config }> })?.users ?? []).map((u) => ({
			uuid: u.uuid,
			config: u.config
		}));
	}

	async resetPassword(uuid: string, newPassword: string): Promise<void> {
		const r = await this.admin('reset-password', {
			method: 'POST',
			path: `/api/admin/users/${encodeURIComponent(uuid)}/reset-password`,
			body: { newPassword },
			scrub: [newPassword]
		});
		if (r.status !== 200) throw this.error('reset-password', r, [newPassword]);
	}

	async health(): Promise<HealthResult> {
		const checks: HealthResult['checks'] = [];
		let version: string | undefined;
		for (const path of ['/health/live', '/health/ready']) {
			const started = Date.now();
			try {
				const r = await this.req('health', { method: 'GET', path, timeoutMs: 5000, retries429: 0 });
				const ok = r.status === 200;
				const v = (r.json as { version?: string } | undefined)?.version;
				if (typeof v === 'string') version ??= v;
				let detail: string | undefined = ok ? undefined : `HTTP ${r.status}`;
				if (path === '/health/ready' && !ok) {
					const s = (r.json as { status?: string } | undefined)?.status;
					if (s) detail = `HTTP ${r.status} (${s})`;
				}
				checks.push({ endpoint: path, ok, latencyMs: Date.now() - started, detail });
			} catch (e) {
				checks.push({ endpoint: path, ok: false, latencyMs: Date.now() - started, detail: (e as Error).message });
			}
		}
		return { ok: checks.every((c) => c.ok), version, checks };
	}
}
