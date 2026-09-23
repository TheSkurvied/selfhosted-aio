import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { aadFor, open, seal } from '../crypto';
import { db, t } from '../db';
import { hashRecoveryCode, looksLikeRecoveryCode } from './recovery';
import { totpKeyFromString, totpKeyToString, verifyTotp } from './totp';

export function sealTotpKey(adminId: string, key: Uint8Array): string {
	return seal(totpKeyToString(key), aadFor('admins', 'totp_secret_enc', adminId));
}

export function openTotpKey(adminId: string, sealed: string): Uint8Array {
	return totpKeyFromString(open(sealed, aadFor('admins', 'totp_secret_enc', adminId)));
}

/**
 * Check a TOTP code (with replay guard) or consume a recovery code.
 * Returns which factor matched, or null.
 */
export async function verifySecondFactor(
	adminId: string,
	input: string
): Promise<'totp' | 'recovery' | null> {
	const [admin] = await db.select().from(t.admins).where(eq(t.admins.id, adminId));
	if (!admin) return null;
	const code = input.trim();

	if (/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
		if (!admin.totpSecretEnc) return null;
		const key = openTotpKey(admin.id, admin.totpSecretEnc);
		const counter = verifyTotp(key, code, admin.totpLastCounter ?? null);
		if (counter === null) return null;
		const updated = await db
			.update(t.admins)
			.set({ totpLastCounter: counter })
			.where(
				and(
					eq(t.admins.id, admin.id),
					or(isNull(t.admins.totpLastCounter), lt(t.admins.totpLastCounter, counter))
				)
			)
			.returning({ id: t.admins.id });
		return updated.length === 1 ? 'totp' : null;
	}

	if (looksLikeRecoveryCode(code)) {
		const h = hashRecoveryCode(code);
		const updated = await db
			.update(t.admins)
			.set({ recoveryCodesHash: sql`array_remove(${t.admins.recoveryCodesHash}, ${h})` })
			.where(and(eq(t.admins.id, admin.id), sql`${h} = any(${t.admins.recoveryCodesHash})`))
			.returning({ id: t.admins.id });
		return updated.length === 1 ? 'recovery' : null;
	}
	return null;
}
