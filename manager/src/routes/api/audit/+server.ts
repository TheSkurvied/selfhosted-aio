import { api } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	api(() =>
		s.listAudit({
			personId: url.searchParams.get('person') ?? url.searchParams.get('personId') ?? undefined,
			action: url.searchParams.get('action') ?? undefined,
			before: url.searchParams.get('before') ?? undefined,
			limit: url.searchParams.has('limit')
				? Number(url.searchParams.get('limit')) || undefined
				: undefined
		})
	);
