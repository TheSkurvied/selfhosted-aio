/**
 * The job runner: concurrency 2, 250 ms between job starts, up to 3 attempts
 * for transient upstream errors (with backoff, honouring Retry-After).
 */
import { UpstreamError } from '../adapters/http';
import { sanitize } from '../adapters/http';
import { db, t } from '../db';
import type { Job } from '../db/schema';
import { log } from '../log';
import { allSecretValues, openAccount } from '../services/core';
import { handlers, PermanentJobError } from './handlers';
import { claimNext, finishJob, onEnqueue, recoverStaleJobs, setProgress } from './queue';

export type RunnerOptions = {
	concurrency?: number;
	spacingMs?: number;
	maxAttempts?: number;
	/** Base retry delay; doubles per attempt. */
	backoffMs?: number;
	pollMs?: number;
};

const DEFAULTS: Required<RunnerOptions> = {
	concurrency: 2,
	spacingMs: 250,
	maxAttempts: 3,
	backoffMs: 5000,
	pollMs: 2000
};

let opts: Required<RunnerOptions> = { ...DEFAULTS };
let running = false;
let active = 0;
let loopPromise: Promise<void> | null = null;
let wake: (() => void) | null = null;
const inflight = new Set<Promise<void>>();

function sleepOrWake(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		timer.unref?.();
		function done() {
			clearTimeout(timer);
			if (wake === done) wake = null;
			resolve();
		}
		wake = done;
	});
}

function poke() {
	wake?.();
}

/** Every secret-ish value we know of, used to scrub error text before it is stored. */
async function scrubValues(): Promise<string[]> {
	const out = await allSecretValues();
	try {
		const accts = await db.select().from(t.accounts);
		for (const a of accts) {
			try {
				const c = openAccount(a);
				for (const v of [c.password, c.manifestSecret, c.manifestUrl]) if (v) out.push(v);
			} catch {
				// ignore undecryptable rows
			}
		}
	} catch {
		// best effort
	}
	return out;
}

async function execute(job: Job) {
	const handler = handlers[job.type];
	const lastAttempt = job.attempts >= opts.maxAttempts;
	try {
		if (!handler) throw new PermanentJobError(`unknown job type ${job.type}`);
		const result = await handler(job, {
			lastAttempt,
			progress: (m) => setProgress(job.id, m)
		});
		await finishJob(job.id, {
			status: 'done',
			progress: typeof result === 'string' ? result : null
		});
	} catch (err) {
		const transient =
			err instanceof UpstreamError ? err.transient : !(err instanceof PermanentJobError);
		const message = sanitize(err instanceof Error ? err.message : String(err), await scrubValues());
		if (transient && !lastAttempt) {
			const retryAfter = err instanceof UpstreamError ? err.retryAfterMs : undefined;
			const delay = Math.max(retryAfter ?? 0, opts.backoffMs * 2 ** (job.attempts - 1));
			await finishJob(job.id, {
				status: 'queued',
				error: message,
				runAfter: new Date(Date.now() + delay),
				progress: `retrying in ${Math.round(delay / 1000)}s`
			});
			setTimeout(poke, delay + 10).unref?.();
		} else {
			await finishJob(job.id, { status: 'failed', error: message });
			log.warn('job failed', {
				jobId: job.id,
				type: job.type,
				attempts: job.attempts,
				error: message
			});
		}
	}
}

async function loop() {
	while (running) {
		if (active >= opts.concurrency) {
			await sleepOrWake(opts.pollMs);
			continue;
		}
		let job: Job | null = null;
		try {
			job = await claimNext();
		} catch (err) {
			log.error('job claim failed', { error: (err as Error).message });
			await sleepOrWake(opts.pollMs);
			continue;
		}
		if (!job) {
			await sleepOrWake(opts.pollMs);
			continue;
		}
		active++;
		const p = execute(job)
			.catch((err) =>
				log.error('job execution crashed', { jobId: job!.id, error: (err as Error).message })
			)
			.finally(() => {
				active--;
				inflight.delete(p);
				poke();
			});
		inflight.add(p);
		// spacing between job starts
		await new Promise((r) => setTimeout(r, opts.spacingMs));
	}
}

export async function startJobRunner(options: RunnerOptions = {}): Promise<void> {
	if (running) return;
	opts = { ...DEFAULTS, ...options };
	const recovered = await recoverStaleJobs();
	if (recovered) log.info('recovered stale jobs', { count: recovered });
	running = true;
	onEnqueue(poke);
	loopPromise = loop();
	log.info('job runner started', { concurrency: opts.concurrency });
}

/** Stop claiming new jobs and wait for in-flight ones. */
export async function stopJobRunner(): Promise<void> {
	if (!running) return;
	running = false;
	onEnqueue(null);
	poke();
	await loopPromise;
	await Promise.all([...inflight]);
	loopPromise = null;
}

export function isRunnerRunning(): boolean {
	return running;
}
