/**
 * Failed-login rate limit: 5 failures per 15 minutes per bucket. Buckets are
 * stored in login_attempts so the limit survives restarts.
 */
import { and, eq, gte, lt, count, sql } from 'drizzle-orm';
import { db, t } from '../db';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export function loginBucket(email: string, ip: string): string {
	return `login:${email.trim().toLowerCase()}|${ip}`;
}

export function totpBucket(adminId: string, ip: string): string {
	return `totp:${adminId}|${ip}`;
}

/** Pure: is a bucket with these failure timestamps blocked at `now`? */
export function isBlocked(failures: Date[], now: Date = new Date()): boolean {
	const since = now.getTime() - WINDOW_MS;
	return failures.filter((d) => d.getTime() > since).length >= MAX_FAILURES;
}

export async function isRateLimited(bucket: string, now: Date = new Date()): Promise<boolean> {
	const [row] = await db
		.select({ n: count() })
		.from(t.loginAttempts)
		.where(
			and(
				eq(t.loginAttempts.key, bucket),
				gte(t.loginAttempts.at, new Date(now.getTime() - WINDOW_MS))
			)
		);
	return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordFailure(bucket: string, now: Date = new Date()): Promise<void> {
	await db.insert(t.loginAttempts).values({ key: bucket, at: now });
	// Opportunistic cleanup of old rows.
	if (Math.random() < 0.05) {
		await db
			.delete(t.loginAttempts)
			.where(lt(t.loginAttempts.at, new Date(now.getTime() - WINDOW_MS)));
	}
}

export async function clearFailures(bucket: string): Promise<void> {
	await db.delete(t.loginAttempts).where(eq(t.loginAttempts.key, bucket));
}

/**
 * Reserve an attempt atomically: under a per-bucket advisory lock, count the
 * window and record the attempt in one transaction, so a concurrent burst
 * cannot all pass a check made before any failure was recorded (at most
 * MAX_FAILURES are admitted per window). The row is the failure record; call
 * release() when the attempt succeeded. A refused attempt is not recorded.
 */
export async function reserveAttempt(
	bucket: string,
	now: Date = new Date()
): Promise<{ allowed: boolean; release: () => Promise<void> }> {
	const id = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'ratelimit:' + bucket}))`);
		const [c] = await tx
			.select({ n: count() })
			.from(t.loginAttempts)
			.where(
				and(
					eq(t.loginAttempts.key, bucket),
					gte(t.loginAttempts.at, new Date(now.getTime() - WINDOW_MS))
				)
			);
		if ((c?.n ?? 0) >= MAX_FAILURES) return null;
		const [row] = await tx
			.insert(t.loginAttempts)
			.values({ key: bucket, at: now })
			.returning({ id: t.loginAttempts.id });
		return row.id;
	});
	if (!id) return { allowed: false, release: async () => {} };
	if (Math.random() < 0.05) {
		await db
			.delete(t.loginAttempts)
			.where(lt(t.loginAttempts.at, new Date(now.getTime() - WINDOW_MS)));
	}
	return {
		allowed: true,
		release: async () => {
			await db.delete(t.loginAttempts).where(eq(t.loginAttempts.id, id));
		}
	};
}
