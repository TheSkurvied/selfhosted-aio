import { api } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) =>
	api(() => s.getTemplateVersion(params.id, params.versionId));
