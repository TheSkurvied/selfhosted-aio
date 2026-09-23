import { error, redirect } from '@sveltejs/kit';
import { audit } from '$lib/server/audit';
import { clientIp, markAdminsExist, requestMeta, startSession } from '$lib/server/auth';
import { OidcError, adminForOidc, completeOidc } from '$lib/server/auth/oidc';
import { env } from '$lib/server/env';
import { log } from '$lib/server/log';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!env.oidcEnabled) error(404, 'Single sign-on is not configured.');
	const ip = clientIp(event);
	let identity: { sub: string; email: string };
	try {
		identity = await completeOidc(event.cookies, event.url.searchParams);
	} catch (err) {
		log.warn('oidc callback failed', {
			reason: err instanceof OidcError ? err.message : String(err)
		});
		redirect(303, '/login?error=sso');
	}
	const admin = await adminForOidc(identity);
	if (!admin) {
		await audit({
			actor: 'system',
			action: 'auth.login_failed',
			summary: `SSO login refused for ${identity.email} (not in ADMIN_EMAILS)`,
			ip
		});
		redirect(303, '/login?error=sso_denied');
	}
	markAdminsExist();
	await startSession(event.cookies, admin.id, requestMeta(event));
	await audit({
		actor: admin.id,
		action: 'auth.login',
		targetType: 'admin',
		targetId: admin.id,
		summary: admin.created
			? `Signed in with SSO (admin ${admin.email} created)`
			: 'Signed in with SSO',
		ip
	});
	redirect(303, '/');
};
