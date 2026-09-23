import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const put = z.object({ value: z.string().min(1).max(8192) });

export const PUT: RequestHandler = (event) =>
	api(async () => {
		const { value } = await body(event, put);
		await s.setSecret(actorOf(event), 'person', event.params.id, event.params.name, value);
		return { ok: true };
	});

export const DELETE: RequestHandler = (event) =>
	api(async () => {
		await s.deleteSecret(actorOf(event), 'person', event.params.id, event.params.name);
		return { ok: true };
	});
