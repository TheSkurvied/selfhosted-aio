import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createTemplate,
	extractSecrets,
	listTemplates,
	seedStarterTemplates,
	STARTERS
} from '$lib/server/services';
import {
	actorOf,
	attempt,
	badInput,
	jsonObject,
	kindOf,
	optStr,
	str
} from '../_lib/helpers.server';
import { applyExtract, extractFound } from '../_lib/extract.server';
import { plural } from '../_lib/format';

export const load: PageServerLoad = async () => {
	const templates = await listTemplates();
	return {
		templates,
		starters: STARTERS.map((s) => ({
			name: s.name,
			kind: s.kind,
			description: s.description,
			body: JSON.stringify(s.body, null, 2)
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const fd = await request.formData();
		const res = await attempt(async () => {
			const name = str(fd, 'name');
			if (!name) throw badInput('Name is required');
			const kind = kindOf(str(fd, 'kind'));
			const body = jsonObject(fd, 'body', 'Body');
			const { found } = extractSecrets(body);
			if (found.length)
				throw badInput(
					`The body has ${plural(found.length, 'value')} that look${found.length === 1 ? 's' : ''} like a key (${found
						.slice(0, 3)
						.map((f) => f.path)
						.join(', ')}). Use "Extract secrets" first.`
				);
			return createTemplate(actorOf(locals), {
				name,
				kind,
				description: optStr(fd, 'description'),
				body,
				note: optStr(fd, 'note') ?? 'Initial version'
			});
		}, 'create template');
		if ('id' in res) redirect(303, `/templates/${res.id}`);
		return res;
	},
	seed: async ({ locals }) =>
		attempt(async () => {
			const { created } = await seedStarterTemplates(actorOf(locals));
			return {
				message: created.length
					? `Added ${plural(created.length, 'starter template')}`
					: 'Starter templates already exist'
			};
		}, 'seed starters'),
	extract: async ({ request }) => {
		const fd = await request.formData();
		return attempt(async () => extractFound(fd), 'extract');
	},
	applyExtract: async ({ request, locals }) => {
		const fd = await request.formData();
		return attempt(async () => applyExtract(fd, actorOf(locals)), 'apply extract');
	}
};
