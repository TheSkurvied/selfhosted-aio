import { api, actorOf, body, jsonObject, kindSchema } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => api(() => s.listTemplates());

const create = z.object({
	name: z.string().min(1).max(200),
	kind: kindSchema,
	description: z.string().max(10_000).optional(),
	body: jsonObject,
	note: z.string().max(2000).optional()
});

export const POST: RequestHandler = (event) =>
	api(async () => s.createTemplate(actorOf(event), await body(event, create)), 201);
