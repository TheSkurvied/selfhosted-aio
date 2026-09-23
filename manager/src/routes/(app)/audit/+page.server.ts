import type { Actions, PageServerLoad } from './$types';
import { listAudit, listPeople } from '$lib/server/services';

const PAGE = 50;

export const load: PageServerLoad = async ({ url }) => {
	const personId = url.searchParams.get('person') || undefined;
	const action = url.searchParams.get('action') || undefined;
	const before = url.searchParams.get('before') || undefined;
	const [rows, people] = await Promise.all([
		listAudit({ personId, action, before, limit: PAGE + 1 }),
		listPeople()
	]);
	return {
		rows: rows.slice(0, PAGE),
		hasMore: rows.length > PAGE,
		filters: { person: personId ?? '', action: action ?? '' },
		people: people.map((p) => ({ id: p.id, name: p.displayName }))
	};
};

export const actions: Actions = {
	more: async ({ request }) => {
		const fd = await request.formData();
		const get = (k: string) => {
			const v = fd.get(k);
			return typeof v === 'string' && v ? v : undefined;
		};
		const rows = await listAudit({
			personId: get('person'),
			action: get('action'),
			before: get('before'),
			limit: PAGE + 1
		});
		return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE };
	}
};
