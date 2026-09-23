import { asc } from 'drizzle-orm';
import { getAdapter } from '../adapters';
import { keyFingerprint } from '../crypto';
import { db, t } from '../db';
import type { InstanceKind } from '../db/schema';
import { env } from '../env';
import { listJobRows, type JobRow } from '../jobs/queue';
import { instanceRows, KINDS } from './core';

export { subscribeJobs } from '../jobs/queue';

type HealthEntry = {
	kind: InstanceKind;
	publicUrl: string;
	ok: boolean;
	version?: string;
	checks: Array<{ endpoint: string; ok: boolean; latencyMs: number; detail?: string }>;
};

let healthCache: { at: number; value: HealthEntry[] } | null = null;
const HEALTH_TTL_MS = 30_000;

/** Both instances' health (cached for 30 s). Pass `fresh` to bypass the cache. */
export async function getHealth(opts: { fresh?: boolean } = {}): Promise<HealthEntry[]> {
	if (!opts.fresh && healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS)
		return healthCache.value;
	const value = await Promise.all(
		KINDS.map(async (kind) => {
			const a = getAdapter(kind);
			const h = await a.health();
			return { kind, publicUrl: a.publicUrl, ok: h.ok, version: h.version, checks: h.checks };
		})
	);
	healthCache = { at: Date.now(), value };
	return value;
}

export async function listJobs(q: { status?: string; limit?: number } = {}): Promise<JobRow[]> {
	return listJobRows(q);
}

export async function getSettings(): Promise<{
	instances: Array<{
		kind: InstanceKind;
		internalUrl: string;
		publicUrl: string;
		authConfigured: boolean;
	}>;
	oidcEnabled: boolean;
	admins: Array<{ id: string; email: string; totp: boolean; oidc: boolean; createdAt: Date }>;
	keyFingerprint: string;
	checkIntervalHours: number;
	ntfy: boolean;
}> {
	const insts = await instanceRows();
	const admins = await db.select().from(t.admins).orderBy(asc(t.admins.createdAt));
	return {
		instances: KINDS.map((k) => insts.get(k)!)
			.filter(Boolean)
			.map((r) => ({
				kind: r.kind,
				internalUrl: r.internalUrl,
				publicUrl: r.publicUrl,
				authConfigured: !!r.authJsonEnc
			})),
		oidcEnabled: env.oidcEnabled,
		admins: admins.map((a) => ({
			id: a.id,
			email: a.email,
			totp: !!a.totpSecretEnc,
			oidc: !!a.oidcSub,
			createdAt: a.createdAt
		})),
		keyFingerprint: keyFingerprint(),
		checkIntervalHours: env.CHECK_INTERVAL_HOURS,
		ntfy: !!env.NTFY_URL
	};
}
