/**
 * Live job list: seeds from load data, then applies updates from the SSE stream at
 * /api/jobs/stream. If the stream cannot be opened (or keeps failing), it falls back to
 * calling `onpoll` (usually `invalidate('app:jobs')`) every few seconds.
 */
import type { JobRow } from './types';

interface Options {
	/** Max rows kept (newest first). */
	limit?: number;
	/** Keep only rows passing this filter (e.g. the active status tab). */
	filter?: (job: JobRow) => boolean;
	/** Fallback refresh when SSE is not available. */
	onpoll?: () => void | Promise<void>;
	pollMs?: number;
	/** Called for every update received (after merge). */
	onjob?: (job: JobRow) => void;
}

function time(v: Date | string | null | undefined) {
	return v ? new Date(v).getTime() : 0;
}

function parseJob(raw: string): JobRow | null {
	try {
		const v = JSON.parse(raw) as unknown;
		if (!v || typeof v !== 'object') return null;
		const o = v as Record<string, unknown>;
		const job = (o.job && typeof o.job === 'object' ? o.job : o) as JobRow;
		return typeof job.id === 'string' && typeof job.status === 'string' ? job : null;
	} catch {
		return null;
	}
}

export class LiveJobs {
	jobs = $state<JobRow[]>([]);
	mode = $state<'connecting' | 'live' | 'polling' | 'off'>('off');
	private opts: Options;

	constructor(opts: Options = {}) {
		this.opts = opts;
	}

	/** Replace the list with fresh load data. */
	reset(rows: JobRow[]) {
		this.jobs = this.sorted(rows);
	}

	private sorted(rows: JobRow[]) {
		const f = this.opts.filter;
		const list = (f ? rows.filter(f) : rows).toSorted(
			(a, b) => time(b.createdAt) - time(a.createdAt)
		);
		return this.opts.limit ? list.slice(0, this.opts.limit) : list;
	}

	upsert(job: JobRow) {
		const i = this.jobs.findIndex((j) => j.id === job.id);
		const next =
			i >= 0 ? this.jobs.toSpliced(i, 1, { ...this.jobs[i], ...job }) : [job, ...this.jobs];
		this.jobs = this.sorted(next);
		this.opts.onjob?.(job);
	}

	/** Start listening; returns a stop function (use from onMount / $effect). */
	start(): () => void {
		let es: EventSource | null = null;
		let timer: ReturnType<typeof setInterval> | null = null;
		let failures = 0;
		let stopped = false;

		const poll = () => {
			if (timer || stopped) return;
			this.mode = 'polling';
			timer = setInterval(() => void this.opts.onpoll?.(), this.opts.pollMs ?? 4000);
		};

		if (typeof EventSource === 'undefined') {
			poll();
		} else {
			this.mode = 'connecting';
			es = new EventSource('/api/jobs/stream');
			const onmessage = (e: MessageEvent) => {
				const job = parseJob(String(e.data));
				if (job) this.upsert(job);
			};
			es.onmessage = onmessage;
			es.addEventListener('job', onmessage as EventListener);
			es.onopen = () => {
				failures = 0;
				this.mode = 'live';
				if (timer) {
					clearInterval(timer);
					timer = null;
				}
			};
			es.onerror = () => {
				failures++;
				if (es?.readyState === EventSource.CLOSED || failures >= 3) {
					es?.close();
					es = null;
					poll();
				}
			};
		}

		return () => {
			stopped = true;
			es?.close();
			if (timer) clearInterval(timer);
			this.mode = 'off';
		};
	}
}
