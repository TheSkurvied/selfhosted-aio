/**
 * Small JSON helpers shared by the sync modules: type guards, deep clone and a
 * path format used by diffs, masking and secret extraction.
 *
 * Path format: object keys joined with '.', array indexes as `[n]`, and keys that
 * are not plain identifiers quoted as `["key"]`. Example: `services[0].credentials.apiKey`.
 * The root is the empty string.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = Record<string, unknown>;
export type PathSeg = string | number;

export function isPlainObject(v: unknown): v is JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

export function clone<T>(v: T): T {
	return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

export function formatPath(segs: readonly PathSeg[]): string {
	let out = '';
	for (const s of segs) {
		if (typeof s === 'number') out += `[${s}]`;
		else if (IDENT.test(s)) out += out === '' ? s : `.${s}`;
		else out += `[${JSON.stringify(s)}]`;
	}
	return out;
}

export function parsePath(path: string): PathSeg[] {
	const segs: PathSeg[] = [];
	let i = 0;
	while (i < path.length) {
		const c = path[i];
		if (c === '.') {
			i++;
			continue;
		}
		if (c === '[') {
			if (path[i + 1] === '"') {
				// quoted key: find the closing `"]` honouring escapes
				let j = i + 2;
				while (j < path.length) {
					if (path[j] === '\\') j += 2;
					else if (path[j] === '"') break;
					else j++;
				}
				if (path[j + 1] !== ']') throw new Error(`bad path: ${path}`);
				segs.push(JSON.parse(path.slice(i + 1, j + 1)) as string);
				i = j + 2;
			} else {
				const j = path.indexOf(']', i);
				if (j === -1) throw new Error(`bad path: ${path}`);
				const n = Number(path.slice(i + 1, j));
				if (!Number.isInteger(n) || n < 0) throw new Error(`bad path: ${path}`);
				segs.push(n);
				i = j + 1;
			}
			continue;
		}
		let j = i;
		while (j < path.length && path[j] !== '.' && path[j] !== '[') j++;
		segs.push(path.slice(i, j));
		i = j;
	}
	return segs;
}

export function getAt(root: unknown, segs: readonly PathSeg[]): unknown {
	let cur: unknown = root;
	for (const s of segs) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string | number, unknown>)[s];
	}
	return cur;
}

/** Set a value at an existing path (in place). Returns false when the parent does not exist. */
export function setAt(root: unknown, segs: readonly PathSeg[], value: unknown): boolean {
	if (segs.length === 0) return false;
	const parent = getAt(root, segs.slice(0, -1));
	if (parent === null || typeof parent !== 'object') return false;
	const last = segs[segs.length - 1];
	if (Array.isArray(parent) && typeof last !== 'number') return false;
	(parent as Record<string | number, unknown>)[last] = value;
	return true;
}

/** Visit every leaf (non-container value, including empty containers are skipped). */
export function walkLeaves(
	v: unknown,
	fn: (value: unknown, segs: PathSeg[]) => void,
	segs: PathSeg[] = []
): void {
	if (Array.isArray(v)) v.forEach((x, i) => walkLeaves(x, fn, [...segs, i]));
	else if (isPlainObject(v)) for (const [k, x] of Object.entries(v)) walkLeaves(x, fn, [...segs, k]);
	else fn(v, segs);
}
