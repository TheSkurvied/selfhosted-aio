/**
 * Helpers for the JSON routes under src/routes/api (ENGINE). They wrap the
 * services: zod-validated input, ServiceError -> HTTP status, and never echo
 * internal errors (which could carry upstream text) beyond a generic message.
 */
import { json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { log } from '../log';
import { assertKind } from './core';
import { ServiceError } from './errors';

export function actorOf(event: Pick<RequestEvent, 'locals'>): string {
	const admin = event.locals.admin;
	if (!admin) throw new ServiceError('unauthorized', 401);
	return admin.id;
}

export async function body<T extends z.ZodType>(
	event: Pick<RequestEvent, 'request'>,
	schema: T
): Promise<z.output<T>> {
	let raw: unknown;
	try {
		const text = await event.request.text();
		raw = text ? JSON.parse(text) : {};
	} catch {
		throw new ServiceError('request body must be JSON');
	}
	const r = schema.safeParse(raw);
	if (!r.success) {
		const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
		throw new ServiceError(msg);
	}
	return r.data;
}

export function kindParam(v: string): 'aiostreams' | 'aiometadata' {
	return assertKind(v);
}

/** Run a handler, mapping ServiceError to its status and anything else to 500. */
export async function api(fn: () => Promise<unknown>, status = 200): Promise<Response> {
	try {
		const out = await fn();
		if (out instanceof Response) return out;
		return json(out ?? { ok: true }, { status });
	} catch (err) {
		if (err instanceof ServiceError) return json({ error: err.message }, { status: err.status });
		log.error('api error', { error: err instanceof Error ? err.message : String(err) });
		return json({ error: 'internal error' }, { status: 500 });
	}
}

export const kindSchema = z.enum(['aiostreams', 'aiometadata']);
export const jsonObject = z.record(z.string(), z.unknown());
