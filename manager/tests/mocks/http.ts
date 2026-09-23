/* eslint-disable @typescript-eslint/no-explicit-any -- mocks handle arbitrary upstream JSON */
/** Small shared plumbing for the node:http upstream mocks (no dependencies). */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FaultMatch {
	method?: string;
	/** Matches when the request path (without query) starts with this. */
	pathPrefix?: string;
}

export type Fault =
	/** Answer with this status and body instead of handling the request. */
	| { status: number; body?: unknown }
	/** Never answer (the client times out); the socket is destroyed when the mock stops. */
	| { hang: true }
	/** Answer after a delay, then handle normally. */
	| { delayMs: number }
	/** Destroy the socket without a response (ECONNRESET on the client). */
	| { reset: true };

interface QueuedFault {
	fault: Fault;
	times: number;
	match?: FaultMatch;
}

/** Fault injection shared by both mocks. */
export class FaultQueue {
	private queue: QueuedFault[] = [];

	/** Apply `fault` to the next `times` matching requests. */
	inject(fault: Fault, opts: { times?: number; match?: FaultMatch } = {}) {
		this.queue.push({ fault, times: opts.times ?? 1, match: opts.match });
	}

	clear() {
		this.queue = [];
	}

	get pending() {
		return this.queue.reduce((n, q) => n + q.times, 0);
	}

	take(method: string, path: string): Fault | undefined {
		const i = this.queue.findIndex(
			(q) =>
				(!q.match?.method || q.match.method.toUpperCase() === method) &&
				(!q.match?.pathPrefix || path.startsWith(q.match.pathPrefix))
		);
		if (i === -1) return undefined;
		const q = this.queue[i];
		q.times--;
		if (q.times <= 0) this.queue.splice(i, 1);
		return q.fault;
	}
}

/** Fixed-window counter keyed by bucket name, like express-rate-limit's MemoryStore. */
export class RateLimiter {
	private hits = new Map<string, { count: number; resetAt: number }>();

	/** Returns null when allowed, or seconds until reset when over the limit. */
	hit(
		key: string,
		max: number,
		windowMs: number
	): { limited: boolean; remaining: number; resetSec: number } {
		const now = Date.now();
		let h = this.hits.get(key);
		if (!h || h.resetAt <= now) {
			h = { count: 0, resetAt: now + windowMs };
			this.hits.set(key, h);
		}
		h.count++;
		const resetSec = Math.max(1, Math.ceil((h.resetAt - now) / 1000));
		return { limited: h.count > max, remaining: Math.max(0, max - h.count), resetSec };
	}

	reset() {
		this.hits.clear();
	}
}

export interface Req {
	method: string;
	path: string;
	query: URLSearchParams;
	headers: IncomingMessage['headers'];
	body: any;
	/** Set when the body was present but not valid JSON. */
	bodyError?: string;
	raw: IncomingMessage;
}

export function sendJson(
	res: ServerResponse,
	status: number,
	body: unknown,
	headers: Record<string, string | string[]> = {}
) {
	const text = body === undefined ? '' : JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(text),
		...headers
	});
	// HEAD responses carry headers only; node drops the body for HEAD anyway.
	res.end(text);
}

export async function readRequest(req: IncomingMessage): Promise<Req> {
	const url = new URL(req.url ?? '/', 'http://mock');
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	const text = Buffer.concat(chunks).toString('utf8');
	let body: any = undefined;
	let bodyError: string | undefined;
	if (text.length) {
		try {
			body = JSON.parse(text);
		} catch (e) {
			bodyError = (e as Error).message;
		}
	}
	return {
		method: (req.method ?? 'GET').toUpperCase(),
		path: url.pathname,
		query: url.searchParams,
		headers: req.headers,
		body,
		bodyError,
		raw: req
	};
}

export function readCookie(req: Req, name: string): string | undefined {
	const header = req.headers.cookie;
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
	}
	return undefined;
}

/** Applies a queued fault. Returns true when the request has been fully handled. */
export async function applyFault(fault: Fault | undefined, res: ServerResponse): Promise<boolean> {
	if (!fault) return false;
	if ('hang' in fault) return true;
	if ('reset' in fault) {
		res.socket?.destroy();
		return true;
	}
	if ('delayMs' in fault) {
		await new Promise((r) => setTimeout(r, fault.delayMs));
		return false;
	}
	sendJson(res, fault.status, fault.body ?? { error: 'Injected fault' });
	return true;
}

export async function listen(server: Server, port = 0): Promise<string> {
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => resolve());
	});
	const { port: actual } = server.address() as AddressInfo;
	return `http://127.0.0.1:${actual}`;
}

export async function close(server: Server): Promise<void> {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** SQLite CURRENT_TIMESTAMP format, which is what both upstreams return on SQLite. */
export function sqliteNow(d = new Date()): string {
	return d.toISOString().replace('T', ' ').slice(0, 19);
}
