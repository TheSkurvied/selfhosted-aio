import type { PageServerLoad } from './$types';
import { listJobs } from '$lib/server/services';

const STATUSES = ['queued', 'running', 'done', 'failed'];

export const load: PageServerLoad = async ({ url, depends }) => {
	depends('app:jobs');
	const s = url.searchParams.get('status') ?? '';
	const status = STATUSES.includes(s) ? s : '';
	return { status, jobs: await listJobs({ status: status || undefined, limit: 200 }) };
};
