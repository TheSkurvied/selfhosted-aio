import { api, actorOf, kindParam } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import { ServiceError } from '$lib/server/services';
import type { RequestHandler } from './$types';

/** POST .../{push|check|rotate|adopt}. push/check/rotate queue a job ({jobId}); adopt runs inline. */
export const POST: RequestHandler = (event) =>
	api(async () => {
		const actor = actorOf(event);
		const { id, instance, action } = event.params;
		const kind = kindParam(instance);
		switch (action) {
			case 'push':
				return s.pushBinding(actor, id, kind);
			case 'check':
				return s.checkBinding(actor, id, kind);
			case 'rotate':
				return s.rotateBinding(actor, id, kind);
			case 'adopt':
				await s.adoptRemote(actor, id, kind);
				return { ok: true };
			default:
				throw new ServiceError(`unknown action ${action}`, 404);
		}
	});
