/**
 * `{{secret:name}}` placeholders. A string that is exactly one placeholder is
 * replaced by the secret value; placeholders embedded in a longer string are
 * interpolated. Only string values are scanned (never object keys).
 */
import { isPlainObject } from './json';

/** Secret names: letters, digits, `_`, `-` and `.`, starting with a letter or digit. */
export const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PLACEHOLDER = /\{\{\s*secret:([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\s*\}\}/g;

export function placeholder(name: string): string {
	return `{{secret:${name}}}`;
}

export function isPlaceholderString(s: string): boolean {
	PLACEHOLDER.lastIndex = 0;
	const m = PLACEHOLDER.exec(s);
	PLACEHOLDER.lastIndex = 0;
	return !!m && m.index === 0 && m[0].length === s.length;
}

export function hasPlaceholder(s: string): boolean {
	PLACEHOLDER.lastIndex = 0;
	const found = PLACEHOLDER.test(s);
	// The regex is global, so test() leaves lastIndex past the match; matchAll
	// copies lastIndex, which would make requiredSecrets skip placeholders.
	PLACEHOLDER.lastIndex = 0;
	return found;
}

/** Every secret name referenced anywhere in `body`, sorted and de-duplicated. */
export function requiredSecrets(body: unknown): string[] {
	const names = new Set<string>();
	const visit = (v: unknown) => {
		if (typeof v === 'string') {
			for (const m of v.matchAll(new RegExp(PLACEHOLDER.source, 'g'))) names.add(m[1]);
		} else if (Array.isArray(v)) v.forEach(visit);
		else if (isPlainObject(v)) Object.values(v).forEach(visit);
	};
	visit(body);
	return [...names].sort();
}

/**
 * Replace placeholders using `lookup`. Missing names are reported (sorted,
 * unique) and left in place. Returns a new value; the input is not modified.
 */
export function substitutePlaceholders(
	body: unknown,
	lookup: (name: string) => string | undefined
): { value: unknown; missing: string[] } {
	const missing = new Set<string>();
	const visit = (v: unknown): unknown => {
		if (typeof v === 'string') {
			return v.replace(PLACEHOLDER, (m, name: string) => {
				const s = lookup(name);
				if (s === undefined) {
					missing.add(name);
					return m;
				}
				return s;
			});
		}
		if (Array.isArray(v)) return v.map(visit);
		if (isPlainObject(v)) {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v)) out[k] = visit(x);
			return out;
		}
		return v;
	};
	const value = visit(body);
	return { value, missing: [...missing].sort() };
}
