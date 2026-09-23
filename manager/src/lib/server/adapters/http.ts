/**
 * Upstream HTTP plumbing: timeouts, 429 backoff honouring Retry-After, and
 * error sanitization. Nothing thrown from here contains request bodies,
 * headers or any string listed in `scrub`.
 */
import type { InstanceKind } from '../db/schema';

export type UpstreamErrorCode =
	| 'not_found'
	| 'unauthorized'
	| 'forbidden'
	| 'rate_limited'
	| 'timeout'
	| 'network'
	| 'invalid'
	| 'server'
	| 'protocol'
	| 'config';

const TRANSIENT: ReadonlySet<UpstreamErrorCode> = new Set([
	'rate_limited',
	'timeout',
	'network',
	'server'
]);

export class UpstreamError extends Error {
	readonly name = 'UpstreamError';
	readonly transient: boolean;
	constructor(
		readonly kind: InstanceKind,
		readonly op: string,
		readonly code: UpstreamErrorCode,
		readonly status: number | null,
		detail: string,
		readonly retryAfterMs?: number
	) {
		super(`${kind} ${op}: ${detail}`);
		this.transient = TRANSIENT.has(code);
	}
	/** 401/404-class failures that mean "this config is gone or its password changed". */
	get isMissing(): boolean {
		return this.code === 'not_found' || this.code === 'unauthorized';
	}
}

/** Remove every scrub value (and obvious credential shapes) from a message, then cap its length. */
export function sanitize(message: string, scrub: Iterable<string> = []): string {
	let out = String(message);
	const values = [...new Set(scrub)].filter((s) => typeof s === 'string' && s.length >= 4);
	values.sort((a, b) => b.length - a.length);
	for (const s of values) out = out.split(s).join('[redacted]');
	out = out
		.replace(/(authorization|cookie|x-admin-key)\s*[:=]\s*\S+/gi, '$1: [redacted]')
		.replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{8,}/g, '$1 [redacted]')
		.replace(/\s+/g, ' ')
		.trim();
	return out.length > 300 ? out.slice(0, 297) + '...' : out;
}

export type HttpResult = {
	status: number;
	headers: Headers;
	text: string;
	/** Parsed JSON body, or undefined when the body is not JSON. */
	json: unknown;
};

export type RequestOptions = {
	kind: InstanceKind;
	op: string;
	baseUrl: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
	path: string;
	query?: Record<string, string | number | undefined>;
	headers?: Record<string, string>;
	body?: unknown;
	timeoutMs?: number;
	/** How many times to retry a 429 in place before giving up (default 2). */
	retries429?: number;
	/** Longest in-place wait for a 429 (default 15s); longer Retry-After values bubble up. */
	maxRetryWaitMs?: number;
	scrub?: string[];
};

export const DEFAULT_TIMEOUT_MS = 15_000;
/** AIOStreams validates every addon manifest on create/update; allow a minute. */
export const SLOW_TIMEOUT_MS = 60_000;

/** Parse Retry-After (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
	if (!v) return undefined;
	const n = Number(v);
	if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
	const d = Date.parse(v);
	if (!Number.isNaN(d)) return Math.max(0, d - now);
	return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpRequest(o: RequestOptions): Promise<HttpResult> {
	const url = new URL(o.baseUrl.replace(/\/+$/, '') + o.path);
	for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
	const headers: Record<string, string> = { accept: 'application/json', ...(o.headers ?? {}) };
	let body: string | undefined;
	if (o.body !== undefined) {
		headers['content-type'] = 'application/json';
		body = JSON.stringify(o.body);
	}
	const retries = o.retries429 ?? 2;
	const maxWait = o.maxRetryWaitMs ?? 15_000;
	for (let attempt = 0; ; attempt++) {
		let res: Response;
		try {
			res = await fetch(url, {
				method: o.method,
				headers,
				body,
				redirect: 'manual',
				signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS)
			});
		} catch (err) {
			const e = err as Error & { cause?: { code?: string } };
			if (e.name === 'TimeoutError' || e.name === 'AbortError') {
				throw new UpstreamError(o.kind, o.op, 'timeout', null, `timed out after ${Math.round((o.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`);
			}
			const code = e.cause?.code ?? e.name;
			throw new UpstreamError(o.kind, o.op, 'network', null, sanitize(`unreachable (${code})`, o.scrub));
		}
		const text = o.method === 'HEAD' ? '' : await res.text().catch(() => '');
		let json: unknown;
		if (text) {
			try {
				json = JSON.parse(text);
			} catch {
				json = undefined;
			}
		}
		if (res.status === 429) {
			const ra = parseRetryAfter(res.headers.get('retry-after'));
			const wait = ra ?? Math.min(1000 * 2 ** attempt, 8000);
			if (attempt < retries && wait <= maxWait) {
				await sleep(Math.max(wait, 100));
				continue;
			}
			throw new UpstreamError(o.kind, o.op, 'rate_limited', 429, 'rate limited by upstream', ra);
		}
		return { status: res.status, headers: res.headers, text, json };
	}
}

/** Pull a human message out of an upstream error body (without echoing large bodies). */
export function upstreamMessage(r: HttpResult): string {
	const j = r.json as Record<string, unknown> | undefined;
	if (j && typeof j === 'object') {
		const err = j.error as unknown;
		if (err && typeof err === 'object') {
			const m = (err as { message?: unknown; code?: unknown }).message;
			const c = (err as { code?: unknown }).code;
			if (typeof m === 'string') return typeof c === 'string' ? `${c}: ${m}` : m;
		}
		if (typeof err === 'string') return err;
		if (typeof j.message === 'string') return j.message;
		if (typeof j.detail === 'string') return j.detail;
	}
	return r.text ? r.text.slice(0, 120) : `HTTP ${r.status}`;
}

export function codeForStatus(status: number): UpstreamErrorCode {
	if (status === 401) return 'unauthorized';
	if (status === 403) return 'forbidden';
	if (status === 404) return 'not_found';
	if (status === 408) return 'timeout';
	if (status === 429) return 'rate_limited';
	if (status >= 500) return 'server';
	if (status >= 300 && status < 400) return 'protocol';
	return 'invalid';
}
