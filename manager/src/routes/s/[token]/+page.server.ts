import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveShareToken } from '$lib/server/services';

// Public: no login. Each load counts a view, so only the server render calls it.
export const load: PageServerLoad = async ({ params, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const share = await resolveShareToken(params.token);
	if (!share) error(404, 'This link has expired or is not valid');
	// Install order: metadata first, then streams.
	const order = { aiometadata: 0, aiostreams: 1 } as const;
	return {
		displayName: share.displayName,
		expiresAt: share.expiresAt,
		links: share.links.toSorted((a, b) => order[a.kind] - order[b.kind])
	};
};
