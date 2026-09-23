import { building } from '$app/environment';
import { json, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import {
	SESSION_COOKIE,
	deleteSessionCookie,
	hasAdmins,
	isCrossOriginMutation,
	setSessionCookie,
	validateSessionToken
} from '$lib/server/auth';
import { env, loadEnv } from '$lib/server/env';
import { log } from '$lib/server/log';

const background = () => !building && process.env.DISABLE_BACKGROUND !== '1';

export const init: ServerInit = async () => {
	if (building) return;
	loadEnv(); // fail fast with a readable message
	if (process.env.SKIP_MIGRATIONS !== '1') {
		const { runMigrations } = await import('$lib/server/db/migrate');
		await runMigrations();
	}
	const { seedInstances } = await import('$lib/server/instances');
	await seedInstances();

	if (!background()) return;
	try {
		// ENGINE provides $lib/server/jobs; tolerate its absence.
		const modules = import.meta.glob('./lib/server/jobs/index.ts');
		const loader = modules['./lib/server/jobs/index.ts'];
		if (!loader) {
			log.warn('job runner not present; background work disabled');
			return;
		}
		const jobs = (await loader()) as {
			startJobRunner?: () => unknown;
			startScheduler?: () => unknown;
		};
		await jobs.startJobRunner?.();
		await jobs.startScheduler?.();
	} catch (err) {
		log.error('failed to start background work', { err });
	}
};

const PUBLIC_EXACT = new Set([
	'/login',
	'/login/totp',
	'/setup',
	'/healthz',
	'/favicon.ico',
	'/robots.txt'
]);
const PUBLIC_PREFIX = ['/auth/', '/s/', '/_app/'];

function isPublicPath(pathname: string): boolean {
	if (PUBLIC_EXACT.has(pathname)) return true;
	return PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

const isApi = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');
const isShare = (pathname: string) => pathname.startsWith('/s/');

/**
 * CSRF for everything, not only form content types (SvelteKit's check): a
 * cross-origin POST/PUT/PATCH/DELETE is refused before any session is read.
 */
const csrfHandle: Handle = async ({ event, resolve }) => {
	if (isCrossOriginMutation(event.request, event.url)) {
		const message = 'Cross-origin requests are forbidden';
		return isApi(event.url.pathname)
			? json({ error: message }, { status: 403 })
			: new Response(message, { status: 403, headers: { 'content-type': 'text/plain' } });
	}
	return resolve(event);
};

const sessionHandle: Handle = async ({ event, resolve }) => {
	event.locals.admin = null;
	event.locals.sessionId = null;
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const s = await validateSessionToken(token);
		if (s) {
			event.locals.admin = s.admin;
			event.locals.sessionId = s.sessionId;
			if (s.cookieExpires) setSessionCookie(event.cookies, token, s.cookieExpires);
		} else {
			deleteSessionCookie(event.cookies);
		}
	}
	return resolve(event);
};

const guardHandle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path === '/healthz' || path.startsWith('/_app/') || isShare(path)) return resolve(event);

	if (!(await hasAdmins())) {
		// First run: everything leads to /setup (OIDC logins create admins too).
		if (path === '/setup' || path.startsWith('/auth/')) return resolve(event);
		if (path === '/login' && env.oidcEnabled) return resolve(event);
		if (isApi(path)) return json({ error: 'setup required' }, { status: 401 });
		redirect(303, '/setup');
	}

	if (isPublicPath(path) || event.locals.admin) return resolve(event);
	if (isApi(path)) return json({ error: 'unauthorized' }, { status: 401 });
	redirect(303, '/login');
};

const headersHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const path = event.url.pathname;
	const h = response.headers;
	const set = (k: string, v: string) => {
		try {
			h.set(k, v);
		} catch {
			// immutable headers (e.g. a proxied fetch response); skip
		}
	};
	set('X-Content-Type-Options', 'nosniff');
	set('X-Frame-Options', 'DENY');
	set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
	set('Cross-Origin-Opener-Policy', 'same-origin');
	if (isShare(path)) {
		set('Referrer-Policy', 'no-referrer');
		set('Cache-Control', 'no-store');
		set('X-Robots-Tag', 'noindex, nofollow');
	} else {
		set('Referrer-Policy', 'same-origin');
		set('X-Robots-Tag', 'noindex, nofollow');
		if (!path.startsWith('/_app/')) set('Cache-Control', 'no-store');
	}
	return response;
};

export const handle: Handle = sequence(csrfHandle, sessionHandle, guardHandle, headersHandle);
