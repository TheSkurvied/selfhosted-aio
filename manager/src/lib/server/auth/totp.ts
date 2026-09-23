import { verifyHOTP, createTOTPKeyURI, generateHOTP } from '@oslojs/otp';
import { encodeBase32NoPadding } from '@oslojs/encoding';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = 'AIO Manager';

export function generateTotpKey(): Uint8Array {
	return new Uint8Array(randomBytes(20));
}

export function totpKeyToString(key: Uint8Array): string {
	return Buffer.from(key).toString('base64url');
}

export function totpKeyFromString(s: string): Uint8Array {
	return new Uint8Array(Buffer.from(s, 'base64url'));
}

/** Base32 form for manual entry in an authenticator app. */
export function totpSecretBase32(key: Uint8Array): string {
	return encodeBase32NoPadding(key);
}

export function totpUri(accountName: string, key: Uint8Array): string {
	return createTOTPKeyURI(TOTP_ISSUER, accountName, key, TOTP_PERIOD, TOTP_DIGITS);
}

export function totpQrSvg(uri: string): Promise<string> {
	return QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
}

export function counterAt(nowMs: number): number {
	return Math.floor(nowMs / 1000 / TOTP_PERIOD);
}

/** Generate the code for a given time (tests, reset script). */
export function totpCodeAt(key: Uint8Array, nowMs: number): string {
	return generateHOTP(key, BigInt(counterAt(nowMs)), TOTP_DIGITS);
}

/**
 * Check a 6-digit code against the current step ±1. Returns the matched
 * counter, or null. A counter <= lastCounter is refused (replay guard); the
 * caller must persist the returned counter atomically.
 */
export function verifyTotp(
	key: Uint8Array,
	code: string,
	lastCounter: number | null,
	nowMs = Date.now()
): number | null {
	const clean = code.replace(/\s+/g, '');
	if (!/^\d{6}$/.test(clean)) return null;
	const now = counterAt(nowMs);
	for (const c of [now, now - 1, now + 1]) {
		if (lastCounter !== null && c <= lastCounter) continue;
		if (verifyHOTP(key, BigInt(c), TOTP_DIGITS, clean)) return c;
	}
	return null;
}
