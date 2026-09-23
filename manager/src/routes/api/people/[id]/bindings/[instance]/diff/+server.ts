import { api, kindParam } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) =>
	api(() => s.diffRemote(params.id, kindParam(params.instance)));
