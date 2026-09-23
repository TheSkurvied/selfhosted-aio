import { api, actorOf } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = (event) =>
	api(async () => {
		await s.revokeShareToken(actorOf(event), event.params.id);
		return { ok: true };
	});
