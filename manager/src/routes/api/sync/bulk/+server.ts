import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const input = z.object({
	action: z.enum(['push', 'check']),
	personIds: z.array(z.string().min(1)).max(1000)
});

export const POST: RequestHandler = (event) =>
	api(async () => {
		const b = await body(event, input);
		return s.bulk(actorOf(event), b.action, b.personIds);
	});
