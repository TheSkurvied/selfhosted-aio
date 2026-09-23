/** Client-side mirrors of engine shapes the pages pass around (no server imports in the client). */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobRow {
	id: string;
	type: string;
	status: JobStatus;
	personId?: string | null;
	personName?: string | null;
	kind?: string | null;
	attempts: number;
	error?: string | null;
	createdAt: Date | string;
	finishedAt?: Date | string | null;
	progress?: string | null;
}

export interface AuditRow {
	id: string;
	at: Date | string;
	actorEmail: string;
	action: string;
	targetType?: string | null;
	targetId?: string | null;
	summary: string;
	diffPaths: string[];
}
