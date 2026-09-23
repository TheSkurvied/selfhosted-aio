import { api } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ params }) => api(() => s.dryRunTemplate(params.id));
