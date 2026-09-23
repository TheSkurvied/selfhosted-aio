import { beforeAll, describe, expect, it } from 'vitest';

import { useTestEnv } from '../testing';

beforeAll(() => {
	useTestEnv({ MANAGER_KEY: 'd'.repeat(64) });
});

describe('pending login cookie', () => {
	it('verifies its own signature and expiry', async () => {
		const { signPendingLogin, verifyPendingLogin, PENDING_TTL_MS } = await import('./pending');
		const v = signPendingLogin('admin-1', 1000);
		expect(verifyPendingLogin(v, 1000)).toBe('admin-1');
		expect(verifyPendingLogin(v, 1000 + PENDING_TTL_MS + 1)).toBeNull();
		const [payload, sig] = v.split('.');
		const forged = Buffer.from(JSON.stringify({ a: 'admin-2', e: 9e15 })).toString('base64url');
		expect(verifyPendingLogin(`${forged}.${sig}`, 1000)).toBeNull();
		expect(verifyPendingLogin(`${payload}.x${sig}`, 1000)).toBeNull();
		expect(verifyPendingLogin(undefined)).toBeNull();
	});
});
