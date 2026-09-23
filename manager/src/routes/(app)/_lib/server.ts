/**
 * Server helpers shared by the (app) pages: form parsing and a wrapper that turns
 * ServiceError (and anything unexpected) into `fail()` with a UI-safe message.
 */
import { error, fail, isHttpError, isRedirect, type ActionFailure } from '@sveltejs/kit';
import { log } from '$lib/server/log';

export function actorOf(locals: App.Locals): string {
	if (!locals.admin) error(401, 'Not signed in');
	return locals.admin.id;
}

function statusOf(e: unknown): number | null {
	if (e && typeof e === 'object' && 'status' in e) {
		const s = (e as { status: unknown }).status;
		if (typeof s === 'number' && s >= 400 && s <= 599) return s;
	}
	return null;
}

/** True for errors the engine throws on purpose (ServiceError): their message is safe to show. */
export function isServiceError(e: unknown): e is Error & { status: number } {
	return e instanceof Error && (e.name === 'ServiceError' || statusOf(e) !== null);
}

export function messageOf(e: unknown, fallback = 'Something went wrong. Check the server log.') {
	return isServiceError(e) ? e.message : fallback;
}

/**
 * Run an action body. Returns its result, or `fail(status, { error })` when it throws.
 * Redirects and kit HTTP errors pass through.
 */
export async function attempt<T>(
	fn: () => Promise<T>,
	what = 'action'
): Promise<T | ActionFailure<{ error: string }>> {
	try {
		return await fn();
	} catch (e) {
		if (isRedirect(e) || isHttpError(e)) throw e;
		if (isServiceError(e)) return fail(statusOf(e) ?? 400, { error: e.message });
		log.error(`${what} failed`, { err: e instanceof Error ? e.message : String(e) });
		return fail(500, { error: messageOf(e) });
	}
}

/** Resolve a load-time promise to `{ ok, value }` / `{ ok: false, error }` so pages can stream it safely. */
export async function settle<T>(
	p: Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
	try {
		return { ok: true, value: await p };
	} catch (e) {
		if (!isServiceError(e)) log.warn('load step failed', { err: e instanceof Error ? e.message : String(e) });
		return { ok: false, error: messageOf(e) };
	}
}

export function str(fd: FormData, name: string): string {
	const v = fd.get(name);
	return typeof v === 'string' ? v.trim() : '';
}

export function optStr(fd: FormData, name: string): string | undefined {
	const v = str(fd, name);
	return v === '' ? undefined : v;
}

export function bool(fd: FormData, name: string): boolean {
	const v = fd.get(name);
	return v === 'on' || v === 'true' || v === '1';
}

/** Positive integer or null (empty field). Throws a 400-style error for junk. */
export function optInt(fd: FormData, name: string, label = name): number | null {
	const v = str(fd, name);
	if (v === '') return null;
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) throw badInput(`${label} must be a whole number above 0`);
	return n;
}

export function tagsOf(fd: FormData, name = 'tags'): string[] {
	const all = fd.getAll(name).flatMap((v) => (typeof v === 'string' ? v.split(',') : []));
	return [...new Set(all.map((t) => t.trim()).filter(Boolean))];
}

/** Parse a JSON object field. Throws a 400-style error with a readable message. */
export function jsonObject(fd: FormData, name: string, label = name): Record<string, unknown> {
	const raw = typeof fd.get(name) === 'string' ? (fd.get(name) as string) : '';
	if (raw.trim() === '') return {};
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch (e) {
		throw badInput(`${label} is not valid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) throw badInput(`${label} must be a JSON object`);
	return v as Record<string, unknown>;
}

/** An error that `attempt` shows verbatim with status 400. */
export function badInput(message: string) {
	const e = new Error(message) as Error & { status: number };
	e.name = 'ServiceError';
	e.status = 400;
	return e;
}

export const KINDS = ['aiostreams', 'aiometadata'] as const;
export type Kind = (typeof KINDS)[number];

export function kindOf(v: string): Kind {
	if (v === 'aiostreams' || v === 'aiometadata') return v;
	throw badInput('Unknown instance kind');
}
