import { api, actorOf, body, kindParam, jsonObject } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const put = z.object({
	templateId: z.string().min(1),
	pinnedVersionId: z.string().min(1).nullable().optional(),
	overrides: jsonObject.optional()
});

export const PUT: RequestHandler = (event) =>
	api(async () => {
		const b = await body(event, put);
		await s.setBinding(actorOf(event), event.params.id, kindParam(event.params.instance), {
			templateId: b.templateId,
			pinnedVersionId: b.pinnedVersionId ?? null,
			overrides: b.overrides ?? {}
		});
		return { ok: true };
	});

export const DELETE: RequestHandler = (event) =>
	api(async () => {
		const q = event.url.searchParams.get('deleteUpstream');
		await s.removeBinding(actorOf(event), event.params.id, kindParam(event.params.instance), {
			deleteUpstream: q === 'true' || q === '1'
		});
		return { ok: true };
	});
