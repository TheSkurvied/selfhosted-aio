/**
 * DB-backed job queue + in-process event bus (feeds the SSE route).
 */
import { EventEmitter } from 'node:events';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, t } from '../db';
import type { InstanceKind, Job, JobStatus, JobType } from '../db/schema';

export type JobRow = {
	id: string;
	type: JobType;
	status: JobStatus;
	personId?: string;
	personName?: string;
	kind?: InstanceKind;
	attempts: number;
	error?: string;
	createdAt: Date;
	finishedAt: Date | null;
	progress?: string;
};

const bus = new EventEmitter();
bus.setMaxListeners(1000);

export function subscribeJobs(cb: (job: JobRow) => void): () => void {
	const fn = (j: JobRow) => {
		try {
			cb(j);
		} catch {
			// a broken subscriber must not break the runner
		}
	};
	bus.on('job', fn);
	return () => bus.off('job', fn);
}

export function toJobRow(j: Job, personName?: string | null): JobRow {
	return {
		id: j.id,
		type: j.type,
		status: j.status,
		personId: j.personId ?? undefined,
		personName: personName ?? undefined,
		kind: j.kind ?? undefined,
		attempts: j.attempts,
		error: j.error ?? undefined,
		createdAt: j.createdAt,
		finishedAt: j.finishedAt,
		progress: j.progress ?? undefined
	};
}

export async function emitJob(jobId: string): Promise<void> {
	if (bus.listenerCount('job') === 0) return;
	const [row] = await db
		.select({ job: t.jobs, personName: t.people.displayName })
		.from(t.jobs)
		.leftJoin(t.people, eq(t.people.id, t.jobs.personId))
		.where(eq(t.jobs.id, jobId));
	if (row) bus.emit('job', toJobRow(row.job, row.personName));
}

let wakeListener: (() => void) | null = null;
/** Runner registers this so enqueue() can wake it immediately. */
export function onEnqueue(fn: (() => void) | null) {
	wakeListener = fn;
}

export type EnqueueInput = {
	type: JobType;
	createdBy: string;
	personId?: string | null;
	kind?: InstanceKind | null;
	accountId?: string | null;
	/** Never put secret values here. */
	payload?: Record<string, unknown>;
	runAfter?: Date;
};

/**
 * Queue a job. push/check/rotate for the same person+kind are de-duplicated
 * against an already queued job of the same type (its id is returned).
 */
export async function enqueue(input: EnqueueInput): Promise<string> {
	if (input.personId && input.kind && ['push', 'check', 'rotate'].includes(input.type)) {
		const [dup] = await db
			.select({ id: t.jobs.id })
			.from(t.jobs)
			.where(
				and(
					eq(t.jobs.type, input.type),
					eq(t.jobs.status, 'queued'),
					eq(t.jobs.personId, input.personId),
					eq(t.jobs.kind, input.kind)
				)
			)
			.limit(1);
		if (dup) return dup.id;
	}
	const id = crypto.randomUUID();
	await db.insert(t.jobs).values({
		id,
		type: input.type,
		createdBy: input.createdBy,
		personId: input.personId ?? null,
		kind: input.kind ?? null,
		accountId: input.accountId ?? null,
		payloadJson: input.payload ?? {},
		runAfter: input.runAfter ?? new Date()
	});
	void emitJob(id);
	wakeListener?.();
	return id;
}

/**
 * Claim the next runnable job (FOR UPDATE SKIP LOCKED). A job is not claimed
 * while another job for the same person+kind is running.
 */
export async function claimNext(): Promise<Job | null> {
	return db.transaction(async (tx) => {
		const rows = await tx.execute<{ id: string }>(sql`
			select j.id from jobs j
			where j.status = 'queued' and j.run_after <= now()
			  and (j.person_id is null or not exists (
			    select 1 from jobs r
			    where r.status = 'running' and r.person_id = j.person_id
			      and r.kind is not distinct from j.kind))
			order by j.run_after, j.created_at
			limit 1
			for update of j skip locked`);
		const id = rows[0]?.id;
		if (!id) return null;
		const [job] = await tx
			.update(t.jobs)
			.set({
				status: 'running',
				attempts: sql`${t.jobs.attempts} + 1`,
				startedAt: new Date(),
				finishedAt: null
			})
			.where(eq(t.jobs.id, id))
			.returning();
		return job ?? null;
	});
}

export async function setProgress(jobId: string, progress: string): Promise<void> {
	await db.update(t.jobs).set({ progress }).where(eq(t.jobs.id, jobId));
	void emitJob(jobId);
}

export async function finishJob(
	jobId: string,
	patch: { status: JobStatus; error?: string | null; runAfter?: Date; progress?: string | null }
) {
	await db
		.update(t.jobs)
		.set({
			status: patch.status,
			error: patch.error ?? null,
			...(patch.runAfter ? { runAfter: patch.runAfter } : {}),
			...(patch.progress !== undefined ? { progress: patch.progress } : {}),
			finishedAt: patch.status === 'queued' ? null : new Date()
		})
		.where(eq(t.jobs.id, jobId));
	void emitJob(jobId);
}

/** Jobs left 'running' by a crash or restart go back to the queue. */
export async function recoverStaleJobs(): Promise<number> {
	const rows = await db
		.update(t.jobs)
		.set({ status: 'queued', progress: 'recovered after restart', runAfter: new Date() })
		.where(eq(t.jobs.status, 'running'))
		.returning({ id: t.jobs.id });
	return rows.length;
}

export async function listJobRows(q: { status?: string; limit?: number } = {}): Promise<JobRow[]> {
	const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
	const statuses = ['queued', 'running', 'done', 'failed'];
	const where =
		q.status && statuses.includes(q.status) ? eq(t.jobs.status, q.status as JobStatus) : undefined;
	const rows = await db
		.select({ job: t.jobs, personName: t.people.displayName })
		.from(t.jobs)
		.leftJoin(t.people, eq(t.people.id, t.jobs.personId))
		.where(where)
		.orderBy(desc(t.jobs.createdAt))
		.limit(limit);
	return rows.map((r) => toJobRow(r.job, r.personName));
}

/** Test/CLI helper: wait until the given jobs are done or failed. */
export async function waitForJobs(ids: string[], timeoutMs = 30_000): Promise<Job[]> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const rows = ids.length ? await db.select().from(t.jobs).where(inArray(t.jobs.id, ids)) : [];
		if (rows.every((r) => r.status === 'done' || r.status === 'failed')) return rows;
		if (Date.now() > deadline) {
			throw new Error(`jobs not finished: ${rows.map((r) => `${r.type}:${r.status}`).join(', ')}`);
		}
		await new Promise((r) => setTimeout(r, 50));
	}
}

/** Queued/running jobs, used to wait for the queue to drain. */
export async function pendingJobCount(): Promise<number> {
	const rows = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(t.jobs)
		.where(inArray(t.jobs.status, ['queued', 'running']));
	return rows[0]?.n ?? 0;
}
