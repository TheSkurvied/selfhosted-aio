import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const create = z.object({
	expiresInDays: z.number().positive().max(3650).nullable().optional(),
	maxViews: z.number().int().positive().nullable().optional()
});

export const POST: RequestHandler = (event) =>
	api(
		async () => s.createShareToken(actorOf(event), event.params.id, await body(event, create)),
		201
	);
