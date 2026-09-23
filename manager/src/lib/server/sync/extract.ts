/**
 * Find literal secrets in a config (debrid keys, API keys, tokens) and turn
 * them into `{{secret:name}}` placeholders. Pure; used by the template editor
 * (extractSecrets + applyExtraction) and by adopt/import.
 */
import { hint } from '../crypto';
import { clone, formatPath, getAt, isPlainObject, parsePath, setAt, walkLeaves } from './json';
import { isCredentialPath } from './mask';
import { hasPlaceholder, placeholder, SECRET_NAME } from './placeholders';

export type FoundSecret = { path: string; suggestedName: string; hint: string; value: string };

const DROP_SEGMENTS = new Set(['credentials', 'options', 'secrets', 'tokens', 'keys']);

function snake(s: string): string {
	return s
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^A-Za-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

function suggestName(root: unknown, segs: Array<string | number>): string {
	const parts: string[] = [];
	for (let i = 0; i < segs.length; i++) {
		const s = segs[i];
		if (typeof s === 'number') {
			// name array elements by their id/type when they have one
			const el = getAt(root, segs.slice(0, i + 1));
			const label = isPlainObject(el)
				? [el.id, el.type, el.name].find((x) => typeof x === 'string' && x.trim())
				: undefined;
			if (typeof label === 'string') {
				// "services[0]" -> "realdebrid" (drop the array name itself)
				if (parts.length && typeof segs[i - 1] === 'string') parts.pop();
				parts.push(snake(label));
			} else parts.push(String(s));
			continue;
		}
		if (DROP_SEGMENTS.has(s)) continue;
		if (/^api[_-]?keys$/i.test(s) && i === segs.length - 2) {
			// apiKeys.tmdb -> tmdb_api_key
			parts.push(`${snake(String(segs[i + 1]))}_api_key`);
			break;
		}
		parts.push(snake(s));
	}
	let name = parts.filter(Boolean).join('_').replace(/_+/g, '_').slice(0, 60);
	if (!name || !SECRET_NAME.test(name)) name = 'secret';
	return name;
}

export function extractSecrets(body: object): { body: object; found: FoundSecret[] } {
	const found: FoundSecret[] = [];
	const byValue = new Map<string, string>();
	const usedNames = new Set<string>();
	walkLeaves(body, (v, segs) => {
		if (typeof v !== 'string' || v.length < 4 || hasPlaceholder(v)) return;
		if (!isCredentialPath(segs)) return;
		let name = byValue.get(v);
		if (!name) {
			const base = suggestName(body, segs);
			name = base;
			for (let n = 2; usedNames.has(name); n++) name = `${base}_${n}`;
			usedNames.add(name);
			byValue.set(v, name);
		}
		found.push({ path: formatPath(segs), suggestedName: name, hint: hint(v), value: v });
	});
	const out = applyExtraction(
		body,
		found.map((f) => ({ path: f.path, name: f.suggestedName }))
	);
	return { body: out, found };
}

/** Replace the value at each picked path with `{{secret:name}}`. Unknown paths are ignored. */
export function applyExtraction(body: object, picks: Array<{ path: string; name: string }>): object {
	const out = clone(body);
	for (const p of picks) {
		if (!SECRET_NAME.test(p.name)) throw new Error(`invalid secret name: ${p.name}`);
		const segs = parsePath(p.path);
		if (typeof getAt(out, segs) !== 'string') continue;
		setAt(out, segs, placeholder(p.name));
	}
	return out;
}
