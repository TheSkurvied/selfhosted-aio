import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import {
	clientIp,
	loginBucket,
	reserveAttempt,
	setPendingLogin,
	verifyDummy,
	verifyPassword
} from '$lib/server/auth';
import { db, t } from '$lib/server/db';
import { env } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

const SSO_ERRORS: Record<string, string> = {
	sso: 'Single sign-on failed. Try again.',
	sso_denied: 'That account is not allowed to manage this server.'
};

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.admin) redirect(303, '/');
	const code = url.searchParams.get('error');
	return {
		oidcEnabled: env.oidcEnabled,
		ssoError: code ? (SSO_ERRORS[code] ?? SSO_ERRORS.sso) : null
	};
};

const GENERIC = 'Incorrect email or password.';

export const actions: Actions = {
	default: async (event) => {
		const f = await event.request.formData();
		const email = String(f.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(f.get('password') ?? '');
		if (!email || !password) return fail(400, { error: 'Enter your email and password.', email });

		const ip = clientIp(event);
		const bucket = loginBucket(email, ip);
		// check and record in one step, so a parallel burst cannot bypass the limit
		const attempt = await reserveAttempt(bucket);
		if (!attempt.allowed)
			return fail(429, { error: 'Too many failed attempts. Try again in 15 minutes.', email });

		const [admin] = await db.select().from(t.admins).where(eq(t.admins.email, email));
		const ok = admin?.passwordHash
			? await verifyPassword(admin.passwordHash, password)
			: await verifyDummy(password);
		if (!admin || !ok) {
			// the reserved attempt stays recorded as the failure
			await audit({
				actor: admin?.id ?? 'system',
				action: 'auth.login_failed',
				targetType: 'admin',
				targetId: admin?.id,
				summary: `Failed password login for ${email}`,
				ip
			});
			return fail(400, { error: GENERIC, email });
		}
		await attempt.release();
		if (!admin.totpSecretEnc)
			return fail(400, {
				error:
					'Two-factor authentication is not set up for this account. Run scripts/reset-admin.ts.',
				email
			});

		setPendingLogin(event.cookies, admin.id);
		redirect(303, '/login/totp');
	}
};
