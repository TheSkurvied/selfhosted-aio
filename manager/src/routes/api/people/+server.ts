import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) =>
	api(() =>
		s.listPeople({
			search: url.searchParams.get('search') ?? url.searchParams.get('q') ?? undefined,
			tag: url.searchParams.get('tag') ?? undefined
		})
	);

const create = z.object({
	displayName: z.string().min(1).max(200),
	notes: z.string().max(10_000).optional(),
	tags: z.array(z.string().max(50)).max(50).optional()
});

export const POST: RequestHandler = (event) =>
	api(async () => s.createPerson(actorOf(event), await body(event, create)), 201);
