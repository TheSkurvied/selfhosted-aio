import type { LayoutServerLoad } from './$types';
import { syncSummary } from '$lib/server/services';

type Summary = Awaited<ReturnType<typeof syncSummary>>;

// Sidebar data: the signed-in admin plus sync counts (for badges such as "4 pending").
export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('app:sync');
	const sync: Summary | null = await syncSummary().catch(() => null);
	const attention = sync ? sync.pending + sync.drifted + sync.missing + sync.error : 0;
	return { admin: locals.admin, syncSummary: sync, attention };
};
