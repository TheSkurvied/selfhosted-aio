/** Runs a Flow against a base URL (real upstream or mock) and returns every exchange. */
import { substitute, type ExchangeResult, type Flow, type Step, type Vars } from './flows.ts';

export interface RecordedExchange {
	name: string;
	note?: string;
	request: { method: string; path: string; headers: Record<string, string>; body?: unknown };
	response: ExchangeResult;
	expectStatus: number;
	attempts?: number;
}

export interface FixtureFile {
	service: string;
	variant: string;
	recordedAt: string;
	upstream: { commit?: string; baseUrl: string };
	exchanges: RecordedExchange[];
}

const KEEP_HEADERS = [
	'content-type',
	'set-cookie',
	'retry-after',
	'ratelimit-limit',
	'ratelimit-remaining',
	'ratelimit-reset',
	'ratelimit-policy',
	'content-disposition'
];

async function send(baseUrl: string, step: Step, vars: Vars) {
	const path = substitute(step.path, vars);
	const headers = substitute(step.headers ?? {}, vars);
	const reqBody = step.body === undefined ? undefined : substitute(step.body, vars);
	const res = await fetch(baseUrl + path, {
		method: step.method,
		headers,
		body: reqBody === undefined ? undefined : JSON.stringify(reqBody),
		redirect: 'manual'
	});
	const text = step.method === 'HEAD' ? '' : await res.text();
	let parsed: unknown = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}
	const outHeaders: Record<string, string> = {};
	for (const h of KEEP_HEADERS) {
		const v = h === 'set-cookie' ? res.headers.getSetCookie().join(', ') : res.headers.get(h);
		if (v) outHeaders[h] = v;
	}
	return {
		request: { method: step.method, path, headers, body: reqBody },
		response: { status: res.status, headers: outHeaders, body: parsed } satisfies ExchangeResult
	};
}

export async function runFlow(flow: Flow, baseUrl: string): Promise<RecordedExchange[]> {
	const vars: Vars = { ...flow.initialVars };
	const out: RecordedExchange[] = [];
	for (const step of flow.steps) {
		let attempts = 0;
		let result: Awaited<ReturnType<typeof send>>;
		do {
			attempts++;
			result = await send(baseUrl, step, vars);
		} while (
			step.repeatUntilStatus !== undefined &&
			result.response.status !== step.repeatUntilStatus &&
			attempts < (step.maxRepeats ?? 30)
		);
		if (step.capture && result.response.status === step.expectStatus) step.capture(result.response, vars);
		out.push({
			name: step.name,
			...(step.note ? { note: step.note } : {}),
			request: result.request,
			response: result.response,
			expectStatus: step.expectStatus,
			...(step.repeatUntilStatus !== undefined ? { attempts } : {})
		});
	}
	return out;
}

/**
 * Structural comparison: same keys and value types, recursively. Values are
 * compared exactly only for keys in `exactKeys` (error codes and messages),
 * because ids, timestamps and hashes differ between runs. Paths that start with
 * an entry of `ignore` (e.g. `$.components`) are skipped.
 */
export function shapeDiff(
	expected: unknown,
	actual: unknown,
	opts: { ignore?: string[]; exactKeys?: ReadonlySet<string> } = {},
	path = '$',
	key = ''
): string[] {
	const exactKeys = opts.exactKeys ?? DEFAULT_EXACT_KEYS;
	if (opts.ignore?.some((p) => path === p || path.startsWith(p + '.') || path.startsWith(p + '['))) return [];
	const te = typeOf(expected);
	const ta = typeOf(actual);
	if (te !== ta) return [`${path}: expected ${te}, got ${ta}`];
	if (te === 'array') {
		const e = expected as unknown[];
		const a = actual as unknown[];
		if ((e.length === 0) !== (a.length === 0)) return [`${path}: expected ${e.length} items, got ${a.length}`];
		return e.length ? shapeDiff(e[0], a[0], opts, `${path}[0]`) : [];
	}
	if (te === 'object') {
		const e = expected as Record<string, unknown>;
		const a = actual as Record<string, unknown>;
		const diffs: string[] = [];
		for (const k of Object.keys(e)) {
			if (!(k in a)) {
				if (!opts.ignore?.includes(`${path}.${k}`)) diffs.push(`${path}.${k}: missing`);
			} else diffs.push(...shapeDiff(e[k], a[k], opts, `${path}.${k}`, k));
		}
		for (const k of Object.keys(a)) {
			if (!(k in e) && !opts.ignore?.includes(`${path}.${k}`)) diffs.push(`${path}.${k}: unexpected`);
		}
		return diffs;
	}
	if (exactKeys.has(key) && expected !== actual) {
		return [`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
	}
	return [];
}

export const DEFAULT_EXACT_KEYS: ReadonlySet<string> = new Set([
	'success',
	'detail',
	'error',
	'code',
	'message',
	'missingKeys',
	'requiresAddonPassword',
	'config_status',
	'has_api_keys',
	'tmdb',
	'language',
	'region',
	'catalogs_count',
	'isAdmin',
	'username',
	'source',
	'trusted',
	'checkOwned'
]);

function typeOf(v: unknown): string {
	if (v === null) return 'null';
	if (Array.isArray(v)) return 'array';
	return typeof v;
}
