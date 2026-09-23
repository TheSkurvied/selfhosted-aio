/**
 * "Extract secrets" form actions shared by the new-template modal and the template editor.
 * Secret values never go back to the browser: only paths, suggested names and hints.
 */
import { applyExtraction, extractSecrets, setSecret } from '$lib/server/services';
import { badInput, jsonObject, str } from './helpers.server';

export function extractFound(fd: FormData) {
	const body = jsonObject(fd, 'body', 'Body');
	const { found } = extractSecrets(body);
	return {
		found: found.map((f) => ({ path: f.path, suggestedName: f.suggestedName, hint: f.hint }))
	};
}

type Pick = { path: string; name: string; save?: boolean };

export async function applyExtract(fd: FormData, actor: string) {
	const body = jsonObject(fd, 'body', 'Body');
	let picks: Pick[];
	try {
		picks = JSON.parse(str(fd, 'picks') || '[]') as Pick[];
	} catch {
		throw badInput('Invalid selection');
	}
	if (!Array.isArray(picks)) throw badInput('Invalid selection');
	const { found } = extractSecrets(body);
	const valueAt = new Map(found.map((f) => [f.path, f.value]));
	let out: object;
	try {
		out = applyExtraction(
			body,
			picks.map((p) => ({ path: String(p.path), name: String(p.name).trim() }))
		);
	} catch (e) {
		throw badInput(e instanceof Error ? e.message : 'Could not apply');
	}
	let saved = 0;
	const done = new Set<string>();
	for (const p of picks) {
		const value = valueAt.get(p.path);
		const name = String(p.name).trim();
		if (!p.save || !value || done.has(name)) continue;
		await setSecret(actor, 'shared', null, name, value);
		done.add(name);
		saved++;
	}
	return { body: JSON.stringify(out, null, 2), replaced: picks.length, saved };
}
