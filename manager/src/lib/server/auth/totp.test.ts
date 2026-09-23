import { describe, expect, it } from 'vitest';
import { generateHOTP } from '@oslojs/otp';
import { counterAt, generateTotpKey, totpCodeAt, totpUri, verifyTotp } from './totp';
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from './recovery';

describe('totp', () => {
	const key = generateTotpKey();
	const now = 1_700_000_000_000;
	const code = (offsetSteps: number) => generateHOTP(key, BigInt(counterAt(now) + offsetSteps), 6);

	it('accepts the current code and returns its counter', () => {
		expect(verifyTotp(key, totpCodeAt(key, now), null, now)).toBe(counterAt(now));
	});

	it('accepts ±1 step and rejects ±2', () => {
		expect(verifyTotp(key, code(-1), null, now)).toBe(counterAt(now) - 1);
		expect(verifyTotp(key, code(1), null, now)).toBe(counterAt(now) + 1);
		expect(verifyTotp(key, code(-2), null, now)).toBeNull();
		expect(verifyTotp(key, code(2), null, now)).toBeNull();
	});

	it('refuses replay of a used or older counter', () => {
		const c = counterAt(now);
		expect(verifyTotp(key, code(0), c, now)).toBeNull();
		expect(verifyTotp(key, code(-1), c, now)).toBeNull();
		expect(verifyTotp(key, code(1), c, now)).toBe(c + 1);
	});

	it('rejects malformed input', () => {
		expect(verifyTotp(key, 'abcdef', null, now)).toBeNull();
		expect(verifyTotp(key, '12345', null, now)).toBeNull();
	});

	it('builds an otpauth URI', () => {
		expect(totpUri('a@b.c', key)).toMatch(/^otpauth:\/\/totp\/AIO%20Manager:a%40b\.c\?/);
	});
});

describe('recovery codes', () => {
	it('generates 5 unique 10-char codes with matching hashes', () => {
		const { codes, hashes } = generateRecoveryCodes();
		expect(codes).toHaveLength(5);
		expect(new Set(codes).size).toBe(5);
		for (const [i, c] of codes.entries()) {
			expect(c).toMatch(/^[a-z2-9]{10}$/);
			expect(looksLikeRecoveryCode(c)).toBe(true);
			expect(hashRecoveryCode(c.toUpperCase())).toBe(hashes[i]);
		}
	});
});
