/**
 * Periodic work: checkAll every CHECK_INTERVAL_HOURS (0 disables) and health
 * sampling every 5 minutes into health_samples (rows older than 7 days pruned).
 */
import { lt } from 'drizzle-orm';
import { getAdapter } from '../adapters';
import { db, t } from '../db';
import { env } from '../env';
import { log } from '../log';
import { instanceRows, KINDS } from '../services/core';

const HEALTH_EVERY_MS = 5 * 60 * 1000;
const HEALTH_KEEP_MS = 7 * 24 * 3600 * 1000;

let timers: NodeJS.Timeout[] = [];

export async function sampleHealth(): Promise<void> {
	const insts = await instanceRows();
	for (const kind of KINDS) {
		const inst = insts.get(kind);
		if (!inst) continue;
		try {
			const h = await getAdapter(kind).health();
			if (h.checks.length) {
				await db.insert(t.healthSamples).values(
					h.checks.map((c) => ({
						instanceId: inst.id,
						endpoint: c.endpoint,
						ok: c.ok,
						latencyMs: c.latencyMs,
						bodyExcerpt: c.detail?.slice(0, 200) ?? null
					}))
				);
			}
		} catch (err) {
			log.warn('health sample failed', { kind, error: (err as Error).message });
		}
	}
	await db
		.delete(t.healthSamples)
		.where(lt(t.healthSamples.at, new Date(Date.now() - HEALTH_KEEP_MS)));
}

export async function startScheduler(): Promise<void> {
	stopScheduler();
	const hours = env.CHECK_INTERVAL_HOURS;
	if (hours > 0) {
		const every = hours * 3600 * 1000;
		const t1 = setInterval(() => {
			import('../services/actions')
				.then((a) => a.checkAll('system'))
				.then((r) => log.info('scheduled check queued', { jobs: r.jobIds.length }))
				.catch((err) => log.error('scheduled check failed', { error: (err as Error).message }));
		}, every);
		t1.unref();
		timers.push(t1);
	}
	const t2 = setInterval(() => {
		sampleHealth().catch((err) =>
			log.warn('health sampling failed', { error: (err as Error).message })
		);
	}, HEALTH_EVERY_MS);
	t2.unref();
	timers.push(t2);
	// first sample shortly after boot
	const t3 = setTimeout(() => void sampleHealth().catch(() => {}), 10_000);
	t3.unref();
	timers.push(t3);
	log.info('scheduler started', { checkIntervalHours: hours });
}

export function stopScheduler(): void {
	for (const x of timers) clearInterval(x);
	timers = [];
}
