/**
 * Database sessions. The cookie holds a random token; the DB stores only its
 * sha256, so a leaked DB row cannot be replayed as a cookie.
 * Sessions end after 12h idle or 7 days total. Activity slides the idle window.
 */
import type { Cookies } from '@sveltejs/kit';
import { and, eq, lt, or } from 'drizzle-orm';
import { randomToken, sha256Hex } from '../crypto';
import { db, t } from '../db';
import { env } from '../env';

export const SESSION_COOKIE = 'aio_session';
export const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** Only write last_seen_at when it is at least this old, to limit writes. */
export const TOUCH_INTERVAL_MS = 60 * 1000;

export type SessionTimes = { createdAt: Date; expiresAt: Date; lastSeenAt: Date };
export type SessionAdmin = { id: string; email: string };

/** Pure expiry logic. */
export function sessionStatus(
	s: SessionTimes,
	now: Date = new Date()
): { valid: false } | { valid: true; touch: boolean; cookieExpires: Date } {
	const n = now.getTime();
	if (n >= s.expiresAt.getTime()) return { valid: false };
	if (n - s.lastSeenAt.getTime() >= IDLE_TIMEOUT_MS) return { valid: false };
	const touch = n - s.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
	const lastSeen = touch ? n : s.lastSeenAt.getTime();
	return {
		valid: true,
		touch,
		cookieExpires: new Date(Math.min(s.expiresAt.getTime(), lastSeen + IDLE_TIMEOUT_MS))
	};
}

export function hashSessionToken(token: string): string {
	return sha256Hex('session:' + token);
}

export async function createSession(
	adminId: string,
	meta: { ip?: string | null; userAgent?: string | null } = {},
	now: Date = new Date()
): Promise<{ token: string; expiresAt: Date; cookieExpires: Date }> {
	const token = randomToken(32);
	const expiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);
	await db.insert(t.sessions).values({
		id: hashSessionToken(token),
		adminId,
		createdAt: now,
		expiresAt,
		lastSeenAt: now,
		ip: meta.ip ?? null,
		userAgent: meta.userAgent?.slice(0, 400) ?? null
	});
	return {
		token,
		expiresAt,
		cookieExpires: new Date(Math.min(expiresAt.getTime(), now.getTime() + IDLE_TIMEOUT_MS))
	};
}

/**
 * Look up a cookie token. Returns null (and deletes the row) when expired.
 * Slides last_seen_at when due; `cookieExpires` is set when the cookie should
 * be re-issued with a later expiry.
 */
export async function validateSessionToken(
	token: string,
	now: Date = new Date()
): Promise<{ sessionId: string; admin: SessionAdmin; cookieExpires: Date | null } | null> {
	if (!token || token.length > 200) return null;
	const id = hashSessionToken(token);
	const [row] = await db
		.select({
			createdAt: t.sessions.createdAt,
			expiresAt: t.sessions.expiresAt,
			lastSeenAt: t.sessions.lastSeenAt,
			adminId: t.admins.id,
			email: t.admins.email
		})
		.from(t.sessions)
		.innerJoin(t.admins, eq(t.sessions.adminId, t.admins.id))
		.where(eq(t.sessions.id, id));
	if (!row) return null;
	const status = sessionStatus(row, now);
	if (!status.valid) {
		await db.delete(t.sessions).where(eq(t.sessions.id, id));
		return null;
	}
	if (status.touch) {
		await db.update(t.sessions).set({ lastSeenAt: now }).where(eq(t.sessions.id, id));
	}
	return {
		sessionId: id,
		admin: { id: row.adminId, email: row.email },
		cookieExpires: status.touch ? status.cookieExpires : null
	};
}

/** Delete by session id (the hash stored in locals.sessionId). */
export async function invalidateSession(sessionId: string): Promise<void> {
	await db.delete(t.sessions).where(eq(t.sessions.id, sessionId));
}

export async function invalidateAdminSessions(adminId: string): Promise<void> {
	await db.delete(t.sessions).where(eq(t.sessions.adminId, adminId));
}

export async function deleteExpiredSessions(now: Date = new Date()): Promise<void> {
	await db
		.delete(t.sessions)
		.where(
			or(
				lt(t.sessions.expiresAt, now),
				lt(t.sessions.lastSeenAt, new Date(now.getTime() - IDLE_TIMEOUT_MS))
			)
		);
}

export function setSessionCookie(cookies: Cookies, token: string, expires: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: env.secureCookies,
		sameSite: 'lax',
		expires
	});
}

export function deleteSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, {
		path: '/',
		httpOnly: true,
		secure: env.secureCookies,
		sameSite: 'lax'
	});
}

/** Convenience used by login flows: create a session and set the cookie. */
export async function startSession(
	cookies: Cookies,
	adminId: string,
	meta: { ip?: string | null; userAgent?: string | null }
): Promise<void> {
	const s = await createSession(adminId, meta);
	setSessionCookie(cookies, s.token, s.cookieExpires);
	await db
		.update(t.admins)
		.set({ lastLoginAt: new Date() })
		.where(and(eq(t.admins.id, adminId)));
}
