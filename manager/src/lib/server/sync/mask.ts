/**
 * Masked rendering for display: every known secret value is replaced by its
 * hint (whole string or embedded), and every string at a credential-like path
 * is masked too, even if it is not a known secret. Placeholders are left alone.
 */
import { hint } from '../crypto';
import { isPlainObject, type PathSeg } from './json';
import { hasPlaceholder, isPlaceholderString } from './placeholders';

/**
 * Keys whose string values are credentials. Deliberately narrower than the log
 * redactor: plain `key` (e.g. sortCriteria[].key) is not a credential.
 */
export const CREDENTIAL_KEY =
	/(pass(word)?|secret|token|credential|api[_-]?keys?|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth(orization)?$|cookie|session[_-]?(id|token)?$)/i;
/** Containers whose every string descendant is a credential (services[].credentials, apiKeys). */
export const CREDENTIAL_CONTAINER = /^(credentials|apiKeys|api_keys|keys|tokens|secrets|auth)$/i;

export function isCredentialPath(segs: readonly PathSeg[]): boolean {
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i];
		if (typeof s !== 'string') continue;
		if (i === segs.length - 1 ? CREDENTIAL_KEY.test(s) : CREDENTIAL_CONTAINER.test(s)) return true;
	}
	return false;
}

export function maskString(s: string): string {
	return hint(s);
}

export function maskConfig(value: unknown, secretValues: Iterable<string> = []): unknown {
	// longest first so a value that contains another is replaced whole
	const known = [...new Set(secretValues)]
		.filter((s) => typeof s === 'string' && s.length >= 4)
		.sort((a, b) => b.length - a.length);
	const visit = (v: unknown, segs: PathSeg[]): unknown => {
		if (typeof v === 'string') {
			if (v === '' || isPlaceholderString(v)) return v;
			if (known.includes(v)) return hint(v);
			let out = v;
			for (const s of known) if (out.includes(s)) out = out.split(s).join(hint(s));
			if (out !== v) return out;
			if (isCredentialPath(segs) && !hasPlaceholder(v)) return hint(v);
			return v;
		}
		if (Array.isArray(v)) return v.map((x, i) => visit(x, [...segs, i]));
		if (isPlainObject(v)) {
			const out: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v)) out[k] = visit(x, [...segs, k]);
			return out;
		}
		return v;
	};
	return visit(value, []);
}
