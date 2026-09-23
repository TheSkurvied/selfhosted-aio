import { api, actorOf, body, jsonObject } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const create = z.object({ body: jsonObject, note: z.string().max(2000).optional() });

export const POST: RequestHandler = (event) =>
	api(
		async () => s.saveTemplateVersion(actorOf(event), event.params.id, await body(event, create)),
		201
	);
