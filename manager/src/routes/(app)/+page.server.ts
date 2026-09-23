import type { Actions, PageServerLoad } from './$types';
import {
	checkAll,
	getHealth,
	listAudit,
	listJobs,
	pushAllPending,
	syncSummary
} from '$lib/server/services';
import { actorOf, attempt, settle } from './_lib/helpers.server';
import { plural } from './_lib/format';

export const load: PageServerLoad = async ({ depends }) => {
	depends('app:jobs', 'app:sync');
	const [summary, jobs, audit] = await Promise.all([
		syncSummary(),
		listJobs({ limit: 8 }),
		listAudit({ limit: 8 })
	]);
	// Health talks to both upstreams; stream it so the page renders immediately.
	return { summary, jobs, audit, health: settle(getHealth()) };
};

export const actions: Actions = {
	// Refresh the cached health; the load that follows reads the fresh value.
	health: async () =>
		attempt(async () => {
			await getHealth({ fresh: true });
			return {};
		}),
	pushPending: async ({ locals }) =>
		attempt(async () => {
			const { jobIds } = await pushAllPending(actorOf(locals));
			return {
				message: jobIds.length ? `Queued ${plural(jobIds.length, 'push')}` : 'Nothing is pending'
			};
		}),
	checkAll: async ({ locals }) =>
		attempt(async () => {
			const { jobIds } = await checkAll(actorOf(locals));
			return {
				message: jobIds.length ? `Queued ${plural(jobIds.length, 'check')}` : 'Nothing to check'
			};
		})
};
