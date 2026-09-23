import { redirect } from '@sveltejs/kit';
import { audit } from '$lib/server/audit';
import { clientIp, deleteSessionCookie, invalidateSession } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { locals, cookies } = event;
	if (locals.sessionId) {
		await invalidateSession(locals.sessionId);
		if (locals.admin)
			await audit({
				actor: locals.admin.id,
				action: 'auth.logout',
				targetType: 'admin',
				targetId: locals.admin.id,
				summary: 'Signed out',
				ip: clientIp(event)
			});
	}
	deleteSessionCookie(cookies);
	redirect(303, '/login');
};
