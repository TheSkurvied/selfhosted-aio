/**
 * Short-lived signed cookies for multi-step auth flows.
 *
 * - Pending login (password ok, TOTP not yet): HMAC-signed { adminId, exp }.
 * - Pending setup (TOTP not yet confirmed): sealed with AES-GCM, because it
 *   carries the new password hash and TOTP secret.
 */
import type { Cookies } from '@sveltejs/kit';
import { hmacSign, hmacVerify, open, seal } from '../crypto';
import { env } from '../env';

export const PENDING_LOGIN_COOKIE = 'aio_pending_login';
export const PENDING_SETUP_COOKIE = 'aio_pending_setup';
export const PENDING_TTL_MS = 5 * 60 * 1000;
export const SETUP_TTL_MS = 15 * 60 * 1000;

function cookieOpts(maxAgeSec: number) {
	return {
		path: '/',
		httpOnly: true,
		secure: env.secureCookies,
		sameSite: 'lax' as const,
		maxAge: maxAgeSec
	};
}

export function signPendingLogin(adminId: string, now = Date.now()): string {
	const payload = Buffer.from(JSON.stringify({ a: adminId, e: now + PENDING_TTL_MS })).toString(
		'base64url'
	);
	return payload + '.' + hmacSign('pending-login', payload);
}

export function verifyPendingLogin(value: string | undefined, now = Date.now()): string | null {
	if (!value) return null;
	const [payload, sig] = value.split('.');
	if (!payload || !sig || !hmacVerify('pending-login', payload, sig)) return null;
	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
			a?: unknown;
			e?: unknown;
		};
		if (typeof data.a !== 'string' || typeof data.e !== 'number' || data.e < now) return null;
		return data.a;
	} catch {
		return null;
	}
}

export function setPendingLogin(cookies: Cookies, adminId: string): void {
	cookies.set(PENDING_LOGIN_COOKIE, signPendingLogin(adminId), cookieOpts(PENDING_TTL_MS / 1000));
}

export function readPendingLogin(cookies: Cookies): string | null {
	return verifyPendingLogin(cookies.get(PENDING_LOGIN_COOKIE));
}

export function clearPendingLogin(cookies: Cookies): void {
	cookies.delete(PENDING_LOGIN_COOKIE, { path: '/' });
}

export type PendingSetup = { email: string; passwordHash: string; totpKey: string };

export function setPendingSetup(cookies: Cookies, data: PendingSetup): void {
	const value = seal(JSON.stringify({ ...data, exp: Date.now() + SETUP_TTL_MS }), 'cookie.setup');
	cookies.set(PENDING_SETUP_COOKIE, value, cookieOpts(SETUP_TTL_MS / 1000));
}

export function readPendingSetup(cookies: Cookies): PendingSetup | null {
	const v = cookies.get(PENDING_SETUP_COOKIE);
	if (!v) return null;
	try {
		const d = JSON.parse(open(v, 'cookie.setup')) as PendingSetup & { exp: number };
		if (d.exp < Date.now()) return null;
		return { email: d.email, passwordHash: d.passwordHash, totpKey: d.totpKey };
	} catch {
		return null;
	}
}

export function clearPendingSetup(cookies: Cookies): void {
	cookies.delete(PENDING_SETUP_COOKIE, { path: '/' });
}
