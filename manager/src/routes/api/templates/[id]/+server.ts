import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => api(() => s.getTemplate(params.id));

const patch = z.object({
	name: z.string().min(1).max(200).optional(),
	description: z.string().max(10_000).optional()
});

export const PATCH: RequestHandler = (event) =>
	api(async () => {
		await s.updateTemplateMeta(actorOf(event), event.params.id, await body(event, patch));
		return { ok: true };
	});

export const DELETE: RequestHandler = (event) =>
	api(async () => {
		await s.deleteTemplate(actorOf(event), event.params.id);
		return { ok: true };
	});
