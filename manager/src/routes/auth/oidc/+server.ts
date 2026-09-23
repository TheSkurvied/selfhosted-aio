import { error, redirect } from '@sveltejs/kit';
import { beginOidc } from '$lib/server/auth/oidc';
import { env } from '$lib/server/env';
import { log } from '$lib/server/log';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!env.oidcEnabled) error(404, 'Single sign-on is not configured.');
	let url: URL;
	try {
		url = await beginOidc(cookies);
	} catch (err) {
		log.error('oidc start failed', { err });
		redirect(303, '/login?error=sso');
	}
	redirect(302, url.toString());
};
