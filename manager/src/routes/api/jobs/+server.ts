import { api } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	api(() =>
		s.listJobs({
			status: url.searchParams.get('status') ?? undefined,
			limit: url.searchParams.has('limit')
				? Number(url.searchParams.get('limit')) || undefined
				: undefined
		})
	);
