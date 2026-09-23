/**
 * RFC 7386 JSON Merge Patch: apply and generate.
 * Arrays are replaced whole; `null` in a patch deletes the key.
 */
import { clone, isPlainObject } from './json';

export function applyMergePatch(target: unknown, patch: unknown): unknown {
	if (!isPlainObject(patch)) return clone(patch);
	const out: Record<string, unknown> = isPlainObject(target) ? clone(target) : {};
	for (const [k, v] of Object.entries(patch)) {
		if (v === null) delete out[k];
		else out[k] = applyMergePatch(out[k], v);
	}
	return out;
}

/**
 * Build the merge patch that turns `base` into `target`, so that
 * applyMergePatch(base, createMergePatch(base, target)) deep-equals target.
 * (Exact except where `target` holds explicit nulls inside objects, which
 * RFC 7386 cannot express; those keys are dropped.)
 */
export function createMergePatch(base: unknown, target: unknown): unknown {
	if (!isPlainObject(base) || !isPlainObject(target)) return clone(target);
	const patch: Record<string, unknown> = {};
	for (const k of Object.keys(base)) {
		if (!(k in target) || target[k] === null || target[k] === undefined) {
			if (base[k] !== null && base[k] !== undefined) patch[k] = null;
		}
	}
	for (const [k, v] of Object.entries(target)) {
		if (v === null || v === undefined) continue;
		if (!(k in base) || base[k] === null) {
			patch[k] = clone(stripNulls(v));
			continue;
		}
		if (isPlainObject(base[k]) && isPlainObject(v)) {
			const sub = createMergePatch(base[k], v) as Record<string, unknown>;
			if (Object.keys(sub).length > 0) patch[k] = sub;
		} else if (!deepEqual(base[k], v)) {
			patch[k] = clone(v);
		}
	}
	return patch;
}

function stripNulls(v: unknown): unknown {
	if (!isPlainObject(v)) return v;
	const out: Record<string, unknown> = {};
	for (const [k, x] of Object.entries(v)) if (x !== null && x !== undefined) out[k] = stripNulls(x);
	return out;
}

export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) {
		return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const ka = Object.keys(a).filter((k) => a[k] !== undefined);
		const kb = Object.keys(b).filter((k) => b[k] !== undefined);
		return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
	}
	return false;
}
