import { api, body, jsonObject, kindSchema } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const input = z.object({ kind: kindSchema, body: z.unknown() });

/** Validate a body and list the literal secrets it contains (hints only, never values). */
export const POST: RequestHandler = (event) =>
	api(async () => {
		const b = await body(event, input);
		const v = s.validateTemplateBody(b.kind, b.body);
		const found = jsonObject.safeParse(b.body).success
			? s
					.extractSecrets(b.body as object)
					.found.map((f) => ({ path: f.path, suggestedName: f.suggestedName, hint: f.hint }))
			: [];
		return { ...v, secrets: found };
	});
