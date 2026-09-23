import { hash, verify, type Algorithm } from '@node-rs/argon2';

// Algorithm is a const enum in the typings; 2 = Argon2id.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
	return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		return await verify(passwordHash, password);
	} catch {
		return false;
	}
}

let dummyHash: Promise<string> | null = null;
/** Spend the same time as a real verify when the account does not exist. */
export async function verifyDummy(password: string): Promise<false> {
	dummyHash ??= hashPassword('dummy-password-for-timing');
	await verifyPassword(await dummyHash, password);
	return false;
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string): string | null {
	if (password.length < MIN_PASSWORD_LENGTH)
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
	if (password.length > 1024) return 'Password is too long.';
	return null;
}
