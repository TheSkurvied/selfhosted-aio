import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { db, t } from '../db';
import type { AuditRow } from './types';

export async function listAudit(
	q: { personId?: string; action?: string; limit?: number; before?: string } = {}
): Promise<AuditRow[]> {
	const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
	const conds: SQL[] = [];
	if (q.personId)
		conds.push(and(eq(t.auditLog.targetType, 'person'), eq(t.auditLog.targetId, q.personId))!);
	if (q.action) {
		// "binding" matches binding.push, binding.create, ... ; exact otherwise
		conds.push(
			q.action.includes('.')
				? eq(t.auditLog.action, q.action)
				: sql`(${t.auditLog.action} = ${q.action} or ${t.auditLog.action} like ${q.action + '.%'})`
		);
	}
	if (q.before) {
		let before: Date | null;
		const d = new Date(q.before);
		if (!Number.isNaN(d.getTime()) && /\d{4}-\d{2}-\d{2}/.test(q.before)) before = d;
		else {
			const [row] = await db
				.select({ at: t.auditLog.at })
				.from(t.auditLog)
				.where(eq(t.auditLog.id, q.before));
			before = row?.at ?? null;
		}
		if (before) conds.push(lt(t.auditLog.at, before));
	}
	const rows = await db
		.select({ a: t.auditLog, email: t.admins.email })
		.from(t.auditLog)
		.leftJoin(t.admins, eq(t.admins.id, t.auditLog.actor))
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(desc(t.auditLog.at))
		.limit(limit);
	return rows.map(({ a, email }) => ({
		id: a.id,
		at: a.at,
		actorEmail: email ?? (a.actor === 'system' ? 'system' : a.actor),
		action: a.action,
		targetType: a.targetType,
		targetId: a.targetId,
		summary: a.summary,
		diffPaths: a.diffPathsJson ?? []
	}));
}
