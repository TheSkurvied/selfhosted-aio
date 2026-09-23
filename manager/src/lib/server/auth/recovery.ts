import { randomInt } from 'node:crypto';
import { sha256Hex } from '../crypto';

export const RECOVERY_CODE_COUNT = 5;
export const RECOVERY_CODE_LENGTH = 10;
// No 0/o/1/l/i to avoid transcription errors.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function normalizeRecoveryCode(code: string): string {
	return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
	return sha256Hex('recovery:' + normalizeRecoveryCode(code));
}

export function looksLikeRecoveryCode(input: string): boolean {
	return normalizeRecoveryCode(input).length === RECOVERY_CODE_LENGTH;
}

/** Fresh codes (shown once) and their hashes (stored). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): {
	codes: string[];
	hashes: string[];
} {
	const codes: string[] = [];
	for (let i = 0; i < count; i++) {
		let c = '';
		for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) c += ALPHABET[randomInt(ALPHABET.length)];
		codes.push(c);
	}
	return { codes, hashes: codes.map(hashRecoveryCode) };
}
