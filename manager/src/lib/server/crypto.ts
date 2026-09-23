/**
 * Encryption at rest: AES-256-GCM with MANAGER_KEY.
 *
 * Sealed format: 'v1:' + b64url(nonce 12 bytes) + ':' + b64url(ciphertext) + ':' + b64url(tag 16 bytes)
 * The AAD binds a value to its place (`table.column.rowId`), so a value copied
 * to another row or column fails to open.
 */
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';
import { env } from './env';

const PREFIX = 'v1';
/** Current key version written to `key_version` columns. rotate-key bumps rows it re-seals. */
export const KEY_VERSION = 1;

export function keyFromHex(hex: string): Buffer {
	if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('key must be 64 hex characters');
	return Buffer.from(hex, 'hex');
}

let cachedKey: { hex: string; buf: Buffer } | null = null;
function managerKey(): Buffer {
	const hex = env.MANAGER_KEY;
	if (!cachedKey || cachedKey.hex !== hex) cachedKey = { hex, buf: keyFromHex(hex) };
	return cachedKey.buf;
}

export function sealWithKey(key: Buffer, plain: string, aad: string): string {
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from(aad, 'utf8'));
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		PREFIX,
		nonce.toString('base64url'),
		ct.toString('base64url'),
		tag.toString('base64url')
	].join(':');
}

export function openWithKey(key: Buffer, sealed: string, aad: string): string {
	const parts = sealed.split(':');
	if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('sealed value: bad format');
	const nonce = Buffer.from(parts[1], 'base64url');
	const ct = Buffer.from(parts[2], 'base64url');
	const tag = Buffer.from(parts[3], 'base64url');
	if (nonce.length !== 12 || tag.length !== 16) throw new Error('sealed value: bad format');
	const decipher = createDecipheriv('aes-256-gcm', key, nonce);
	decipher.setAAD(Buffer.from(aad, 'utf8'));
	decipher.setAuthTag(tag);
	try {
		return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
	} catch {
		throw new Error('sealed value: authentication failed');
	}
}

/** Encrypt `plain` with MANAGER_KEY, bound to `aad` (use aadFor()). */
export function seal(plain: string, aad: string): string {
	return sealWithKey(managerKey(), plain, aad);
}

/** Decrypt a value from seal(). Throws if the key, AAD or data are wrong. */
export function open(sealed: string, aad: string): string {
	return openWithKey(managerKey(), sealed, aad);
}

export function aadFor(table: string, column: string, rowId: string): string {
	return `${table}.${column}.${rowId}`;
}

export function sha256Hex(s: string): string {
	return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

/** JSON with object keys sorted recursively and no whitespace. Stable input for hashing. */
export function canonicalJson(v: unknown): string {
	return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
	if (Array.isArray(v)) return v.map((x) => sortKeys(x === undefined ? null : x));
	if (v && typeof v === 'object' && !(v instanceof Date)) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v).sort()) {
			const val = (v as Record<string, unknown>)[k];
			if (val !== undefined) out[k] = sortKeys(val);
		}
		return out;
	}
	return v;
}

/** Masked hint for a secret: '••••' + last 4 characters. */
export function hint(secret: string): string {
	return '••••' + (secret.length > 4 ? secret.slice(-4) : '');
}

/** Derive a purpose-specific 32-byte subkey from MANAGER_KEY (HKDF-SHA256). */
export function deriveKey(purpose: string): Buffer {
	return Buffer.from(
		hkdfSync('sha256', managerKey(), Buffer.alloc(0), `aio-manager:${purpose}`, 32)
	);
}

export function hmacSign(purpose: string, data: string): string {
	return createHmac('sha256', deriveKey(purpose)).update(data, 'utf8').digest('base64url');
}

export function hmacVerify(purpose: string, data: string, sig: string): boolean {
	const expected = Buffer.from(hmacSign(purpose, data), 'base64url');
	const given = Buffer.from(sig, 'base64url');
	return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a, 'utf8');
	const bb = Buffer.from(b, 'utf8');
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Short, non-reversible fingerprint of MANAGER_KEY for the Settings page. */
export function keyFingerprint(): string {
	return createHash('sha256').update(managerKey()).digest('hex').slice(0, 16);
}
