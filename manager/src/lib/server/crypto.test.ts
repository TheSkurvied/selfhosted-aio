import { beforeAll, describe, expect, it } from 'vitest';

import { useTestEnv } from './testing';

beforeAll(() => {
	useTestEnv({ MANAGER_KEY: 'a'.repeat(64) });
});

const load = () => import('./crypto');

describe('crypto', () => {
	it('round-trips with the same AAD', async () => {
		const { sealWithKey, openWithKey, keyFromHex } = await load();
		const key = keyFromHex('b'.repeat(64));
		const sealed = sealWithKey(key, 'hunter2 ünïcode', 'secrets.value_enc.1');
		expect(sealed.startsWith('v1:')).toBe(true);
		expect(sealed.split(':')).toHaveLength(4);
		expect(openWithKey(key, sealed, 'secrets.value_enc.1')).toBe('hunter2 ünïcode');
	});

	it('uses a fresh nonce each time', async () => {
		const { sealWithKey, keyFromHex } = await load();
		const key = keyFromHex('b'.repeat(64));
		expect(sealWithKey(key, 'x', 'a')).not.toBe(sealWithKey(key, 'x', 'a'));
	});

	it('fails with the wrong AAD', async () => {
		const { sealWithKey, openWithKey, keyFromHex, aadFor } = await load();
		const key = keyFromHex('b'.repeat(64));
		const sealed = sealWithKey(key, 'secret', aadFor('secrets', 'value_enc', 'row-1'));
		expect(() => openWithKey(key, sealed, aadFor('secrets', 'value_enc', 'row-2'))).toThrow(
			/authentication failed/
		);
	});

	it('fails with the wrong key', async () => {
		const { sealWithKey, openWithKey, keyFromHex } = await load();
		const sealed = sealWithKey(keyFromHex('b'.repeat(64)), 'secret', 'aad');
		expect(() => openWithKey(keyFromHex('c'.repeat(64)), sealed, 'aad')).toThrow();
	});

	it('detects tampering in ciphertext and tag', async () => {
		const { sealWithKey, openWithKey, keyFromHex } = await load();
		const key = keyFromHex('b'.repeat(64));
		const sealed = sealWithKey(key, 'secret value', 'aad');
		const [v, n, ct, tag] = sealed.split(':');
		const flip = (s: string) => {
			const b = Buffer.from(s, 'base64url');
			b[0] ^= 1;
			return b.toString('base64url');
		};
		expect(() => openWithKey(key, [v, n, flip(ct), tag].join(':'), 'aad')).toThrow();
		expect(() => openWithKey(key, [v, n, ct, flip(tag)].join(':'), 'aad')).toThrow();
		expect(() => openWithKey(key, [v, flip(n), ct, tag].join(':'), 'aad')).toThrow();
		expect(() => openWithKey(key, 'v2:' + sealed.slice(3), 'aad')).toThrow(/format/);
	});

	it('seal/open use MANAGER_KEY', async () => {
		const { seal, open } = await load();
		expect(open(seal('abc', 't.c.1'), 't.c.1')).toBe('abc');
	});

	it('canonicalJson sorts keys recursively without whitespace', async () => {
		const { canonicalJson } = await load();
		const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } });
		const b = canonicalJson({ a: { c: 'x', d: [3, { y: 2, z: 1 }] }, b: 1 });
		expect(a).toBe(b);
		expect(a).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
		expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
	});

	it('hint masks all but the last 4 chars', async () => {
		const { hint } = await load();
		expect(hint('abcdef1a2f')).toBe('••••1a2f');
		expect(hint('abc')).toBe('••••');
	});

	it('sha256Hex and randomToken', async () => {
		const { sha256Hex, randomToken } = await load();
		expect(sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
		expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('hmac sign/verify', async () => {
		const { hmacSign, hmacVerify } = await load();
		const sig = hmacSign('p', 'data');
		expect(hmacVerify('p', 'data', sig)).toBe(true);
		expect(hmacVerify('p', 'datb', sig)).toBe(false);
		expect(hmacVerify('q', 'data', sig)).toBe(false);
	});
});
