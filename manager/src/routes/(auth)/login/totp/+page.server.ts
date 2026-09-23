import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import {
	clearFailures,
	clearPendingLogin,
	clientIp,
	loginBucket,
	readPendingLogin,
	requestMeta,
	reserveAttempt,
	startSession,
	totpBucket,
	verifySecondFactor
} from '$lib/server/auth';
import { db, t } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies, locals }) => {
	if (locals.admin) redirect(303, '/');
	if (!readPendingLogin(cookies)) redirect(303, '/login');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const adminId = readPendingLogin(event.cookies);
		if (!adminId) redirect(303, '/login');
		const code = String((await event.request.formData()).get('code') ?? '');
		const ip = clientIp(event);
		const bucket = totpBucket(adminId, ip);
		// check and record in one step, so a parallel burst cannot bypass the limit
		if (!(await reserveAttempt(bucket)).allowed)
			return fail(429, { error: 'Too many failed attempts. Try again in 15 minutes.' });

		const factor = code.trim() ? await verifySecondFactor(adminId, code) : null;
		if (!factor) {
			// the reserved attempt stays recorded as the failure
			await audit({
				actor: adminId,
				action: 'auth.login_failed',
				targetType: 'admin',
				targetId: adminId,
				summary: 'Failed two-factor code',
				ip
			});
			return fail(400, { error: 'That code is not valid.' });
		}

		const [admin] = await db
			.select({ email: t.admins.email, remaining: t.admins.recoveryCodesHash })
			.from(t.admins)
			.where(eq(t.admins.id, adminId));
		clearPendingLogin(event.cookies);
		await clearFailures(bucket);
		if (admin) await clearFailures(loginBucket(admin.email, ip));
		await startSession(event.cookies, adminId, requestMeta(event));
		await audit({
			actor: adminId,
			action: 'auth.login',
			targetType: 'admin',
			targetId: adminId,
			summary:
				factor === 'totp'
					? 'Signed in with password and TOTP'
					: `Signed in with a recovery code (${admin?.remaining.length ?? 0} left)`,
			ip
		});
		redirect(303, '/');
	}
};
