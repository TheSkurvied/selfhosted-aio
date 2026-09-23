import { api, actorOf, body } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { z } from 'zod';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => api(() => s.getPerson(params.id));

const patch = z.object({
	displayName: z.string().min(1).max(200).optional(),
	notes: z.string().max(10_000).optional(),
	tags: z.array(z.string().max(50)).max(50).optional(),
	disabled: z.boolean().optional()
});

export const PATCH: RequestHandler = (event) =>
	api(async () => {
		await s.updatePerson(actorOf(event), event.params.id, await body(event, patch));
		return { ok: true };
	});

/** ?deleteUpstream=true (or JSON body {deleteUpstream}) also deletes the upstream configs. */
export const DELETE: RequestHandler = (event) =>
	api(async () => {
		const q = event.url.searchParams.get('deleteUpstream');
		const b =
			q === null ? await body(event, z.object({ deleteUpstream: z.boolean().optional() })) : {};
		const deleteUpstream = q !== null ? q === 'true' || q === '1' : !!b.deleteUpstream;
		await s.deletePerson(actorOf(event), event.params.id, { deleteUpstream });
		return { ok: true };
	});
