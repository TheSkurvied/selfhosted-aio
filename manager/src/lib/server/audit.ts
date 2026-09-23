import { db, t } from './db';
import { log } from './log';

export type AuditEvent = {
	/** Admin id, or 'system'. */
	actor: string;
	action: string;
	targetType?: string;
	targetId?: string;
	/** Human readable; must never contain secret values. */
	summary: string;
	/** JSON paths that changed (never values). */
	diffPaths?: string[];
	ip?: string;
};

/**
 * Append an entry to the audit log. Failures are logged, not thrown, so a
 * broken audit write never turns a completed action into an error page.
 */
export async function audit(e: AuditEvent): Promise<void> {
	try {
		await db.insert(t.auditLog).values({
			actor: e.actor,
			action: e.action,
			targetType: e.targetType ?? null,
			targetId: e.targetId ?? null,
			summary: e.summary,
			diffPathsJson: e.diffPaths ?? [],
			ip: e.ip ?? null
		});
	} catch (err) {
		log.error('audit write failed', { action: e.action, err });
	}
}
