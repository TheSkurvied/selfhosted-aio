import { fail, redirect } from '@sveltejs/kit';
import { count, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '$lib/server/audit';
import {
	clearPendingSetup,
	generateRecoveryCodes,
	generateTotpKey,
	hasAdmins,
	hashPassword,
	markAdminsExist,
	passwordProblem,
	readPendingSetup,
	requestMeta,
	sealTotpKey,
	setPendingSetup,
	startSession,
	totpKeyFromString,
	totpKeyToString,
	totpQrSvg,
	totpSecretBase32,
	totpUri,
	verifyTotp
} from '$lib/server/auth';
import { db, t } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const DONE_COOKIE = 'aio_setup_done';

export const load: PageServerLoad = async ({ cookies, locals }) => {
	if (await hasAdmins()) {
		// Keep the page alive right after confirm so the recovery codes can be shown.
		if (cookies.get(DONE_COOKIE) && locals.admin) return { done: true };
		redirect(303, locals.admin ? '/' : '/login');
	}
	return { done: false };
};

async function totpStep(email: string, totpKey: string) {
	const key = totpKeyFromString(totpKey);
	const uri = totpUri(email, key);
	return {
		step: 'totp' as const,
		totpUri: uri,
		totpSecret: totpSecretBase32(key),
		qrSvg: await totpQrSvg(uri)
	};
}

const emailSchema = z.email();

// SvelteKit forbids a `default` action next to named ones, so the first step
// is the named action `setup` (form action="?/setup"), then `?/confirm`.
export const actions: Actions = {
	setup: async ({ request, cookies }) => {
		if (await hasAdmins()) return fail(403, { error: 'Setup is already complete.' });
		const f = await request.formData();
		const email = String(f.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(f.get('password') ?? '');
		const password2 = String(f.get('password2') ?? '');
		if (!emailSchema.safeParse(email).success)
			return fail(400, { error: 'Enter a valid email address.', email });
		const problem = passwordProblem(password);
		if (problem) return fail(400, { error: problem, email });
		if (password !== password2) return fail(400, { error: 'Passwords do not match.', email });

		const totpKey = totpKeyToString(generateTotpKey());
		setPendingSetup(cookies, { email, passwordHash: await hashPassword(password), totpKey });
		return await totpStep(email, totpKey);
	},

	confirm: async (event) => {
		const { request, cookies, locals } = event;
		if (await hasAdmins()) return fail(403, { error: 'Setup is already complete.' });
		const pending = readPendingSetup(cookies);
		if (!pending) return fail(400, { error: 'Setup timed out. Start again.' });
		const code = String((await request.formData()).get('code') ?? '');
		const key = totpKeyFromString(pending.totpKey);
		const counter = verifyTotp(key, code, null);
		if (counter === null)
			return fail(400, {
				...(await totpStep(pending.email, pending.totpKey)),
				error: 'That code did not match. Check the time on your device and try again.'
			});

		const { codes, hashes } = generateRecoveryCodes();
		const adminId = crypto.randomUUID();
		const created = await db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(727274002)`);
			const [row] = await tx.select({ n: count() }).from(t.admins);
			if ((row?.n ?? 0) > 0) return false;
			await tx.insert(t.admins).values({
				id: adminId,
				email: pending.email,
				passwordHash: pending.passwordHash,
				totpSecretEnc: sealTotpKey(adminId, key),
				totpLastCounter: counter,
				recoveryCodesHash: hashes
			});
			return true;
		});
		if (!created) return fail(403, { error: 'Setup is already complete.' });

		markAdminsExist();
		clearPendingSetup(cookies);
		const meta = requestMeta(event);
		await startSession(cookies, adminId, meta);
		locals.admin = { id: adminId, email: pending.email };
		cookies.set(DONE_COOKIE, '1', {
			path: '/setup',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 600,
			secure: event.url.protocol === 'https:'
		});
		await audit({
			actor: adminId,
			action: 'admin.setup',
			targetType: 'admin',
			targetId: adminId,
			summary: `First admin ${pending.email} created`,
			ip: meta.ip
		});
		return { recoveryCodes: codes };
	}
};
