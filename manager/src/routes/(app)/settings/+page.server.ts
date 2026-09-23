import type { Actions, PageServerLoad } from './$types';
import { getSettings, orphanReport, seedStarterTemplates, STARTERS } from '$lib/server/services';
import { actorOf, attempt } from '../_lib/helpers.server';
import { plural } from '../_lib/format';

export const load: PageServerLoad = async ({ locals }) => ({
	settings: await getSettings(),
	me: locals.admin?.id ?? null,
	starters: STARTERS.map((s) => ({ name: s.name, kind: s.kind }))
});

export const actions: Actions = {
	orphans: async () => attempt(async () => ({ orphans: await orphanReport() }), 'orphan report'),
	seed: async ({ locals }) =>
		attempt(async () => {
			const { created } = await seedStarterTemplates(actorOf(locals));
			return {
				message: created.length
					? `Added ${plural(created.length, 'starter template')}`
					: 'All starter templates already exist'
			};
		}, 'seed starters')
};
