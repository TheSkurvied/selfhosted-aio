/**
 * Structured logging: one JSON object per line on stdout (stderr for errors).
 * Any field whose key matches SENSITIVE_KEY is replaced with '[redacted]', at
 * any depth. The log level comes straight from process.env.LOG_LEVEL so logging
 * works even before (or without) the full env being valid.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const SENSITIVE_KEY = /pass|key|token|secret|credential|cookie|authorization/i;

function threshold(): number {
	const l = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
	return LEVELS[l] ?? LEVELS.info;
}

/** Deep-copy `value`, replacing sensitive keys. Errors become { name, message, stack }. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (value === null || typeof value !== 'object') {
		if (typeof value === 'bigint') return value.toString();
		return value;
	}
	if (depth > 8) return '[depth]';
	if (seen.has(value)) return '[circular]';
	seen.add(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		const out: Record<string, unknown> = { name: value.name, message: value.message };
		if (value.stack) out.stack = value.stack.split('\n').slice(0, 8).join('\n');
		const cause = (value as { cause?: unknown }).cause;
		if (cause !== undefined) out.cause = redact(cause, depth + 1, seen);
		return out;
	}
	if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1, seen);
	}
	return out;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
	if (LEVELS[level] < threshold()) return;
	const line: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
	if (fields) Object.assign(line, redact(fields) as Record<string, unknown>);
	let text: string;
	try {
		text = JSON.stringify(line);
	} catch {
		text = JSON.stringify({ ts: line.ts, level, msg, note: 'unserializable fields' });
	}
	if (level === 'error' || level === 'warn') process.stderr.write(text + '\n');
	else process.stdout.write(text + '\n');
}

export const log = {
	debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
	info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
	warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
	error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields)
};
