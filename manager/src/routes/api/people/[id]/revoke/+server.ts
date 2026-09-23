import { api, actorOf } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	api(() => s.revokePerson(actorOf(event), event.params.id));
