import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const input = z.object({
	uuid: z.string().min(1).max(100),
	personId: z.string().min(1).optional(),
	displayName: z.string().max(200).optional(),
	templateId: z.string().min(1).optional()
});

/** Resets the config's password upstream (the person's old password stops working). */
export const POST: RequestHandler = (event) =>
	api(async () => s.importAiometadata(actorOf(event), await body(event, input)), 201);
