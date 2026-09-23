import { api } from '$lib/server/services/api';
import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => api(() => s.listAiometadataCandidates());
