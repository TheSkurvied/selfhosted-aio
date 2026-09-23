import { api, actorOf } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	api(() => s.pushTemplate(actorOf(event), event.params.id));
