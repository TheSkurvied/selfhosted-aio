/**
 * Integration tests against the real local Postgres (TEST_DATABASE_URL).
 * Skipped when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestEnv } from '../testing';

useTestEnv();
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

describe.skipIf(!TEST_DB)('auth against Postgres', () => {
	let db: typeof import('../db').db;
	let t: typeof import('../db').t;
	let closeDb: typeof import('../db').closeDb;
	const adminId = crypto.randomUUID();
	const email = `test-${adminId}@example.com`;

	beforeAll(async () => {
		useTestEnv({ DATABASE_URL: TEST_DB! });
		const { runMigrations } = await import('../db/migrate');
		await runMigrations(TEST_DB!);
		({ db, t, closeDb } = await import('../db'));
		await db.insert(t.admins).values({ id: adminId, email });
	});

	afterAll(async () => {
		if (db) {
			await db.delete(t.admins).where(eq(t.admins.id, adminId));
			await closeDb();
		}
	});

	it('creates and validates a session, storing only the hash', async () => {
		const s = await import('./session');
		const created = await s.createSession(adminId, { ip: '127.0.0.1', userAgent: 'vitest' });
		const [row] = await db
			.select()
			.from(t.sessions)
			.where(eq(t.sessions.id, s.hashSessionToken(created.token)));
		expect(row).toBeDefined();
		expect(row.id).not.toBe(created.token);

		const v = await s.validateSessionToken(created.token);
		expect(v?.admin).toEqual({ id: adminId, email });
		expect(await s.validateSessionToken(created.token + 'x')).toBeNull();
	});

	it('slides last_seen_at and expires idle sessions', async () => {
		const s = await import('./session');
		const created = await s.createSession(adminId);
		const later = new Date(Date.now() + 2 * 60 * 1000);
		const v = await s.validateSessionToken(created.token, later);
		expect(v?.cookieExpires?.getTime()).toBe(later.getTime() + s.IDLE_TIMEOUT_MS);

		const idle = new Date(later.getTime() + s.IDLE_TIMEOUT_MS + 1000);
		expect(await s.validateSessionToken(created.token, idle)).toBeNull();
		const rows = await db
			.select()
			.from(t.sessions)
			.where(eq(t.sessions.id, s.hashSessionToken(created.token)));
		expect(rows).toHaveLength(0);
	});

	it('invalidates a session', async () => {
		const s = await import('./session');
		const created = await s.createSession(adminId);
		await s.invalidateSession(s.hashSessionToken(created.token));
		expect(await s.validateSessionToken(created.token)).toBeNull();
	});

	it('rate limits after 5 failures per bucket', async () => {
		const rl = await import('./ratelimit');
		const bucket = rl.loginBucket(email, '10.0.0.1');
		for (let i = 0; i < rl.MAX_FAILURES - 1; i++) await rl.recordFailure(bucket);
		expect(await rl.isRateLimited(bucket)).toBe(false);
		await rl.recordFailure(bucket);
		expect(await rl.isRateLimited(bucket)).toBe(true);
		expect(await rl.isRateLimited(rl.loginBucket(email, '10.0.0.2'))).toBe(false);
		await rl.clearFailures(bucket);
		expect(await rl.isRateLimited(bucket)).toBe(false);
	});

	it('the old check-then-record pattern lets a concurrent burst through (demo)', async () => {
		const rl = await import('./ratelimit');
		const bucket = rl.totpBucket(adminId, '10.0.0.9');
		const passed = await Promise.all(
			Array.from({ length: 20 }, async () => {
				if (await rl.isRateLimited(bucket)) return false;
				await rl.recordFailure(bucket);
				return true;
			})
		);
		expect(passed.filter(Boolean).length).toBeGreaterThan(rl.MAX_FAILURES);
		await rl.clearFailures(bucket);
	});

	it('reserveAttempt admits at most MAX_FAILURES attempts from a concurrent burst', async () => {
		const rl = await import('./ratelimit');
		const bucket = rl.totpBucket(adminId, '10.0.0.10');
		const results = await Promise.all(Array.from({ length: 25 }, () => rl.reserveAttempt(bucket)));
		expect(results.filter((r) => r.allowed)).toHaveLength(rl.MAX_FAILURES);
		expect(await rl.isRateLimited(bucket)).toBe(true);
		// a released (successful) attempt does not count as a failure
		const other = rl.loginBucket(email, '10.0.0.11');
		const r = await rl.reserveAttempt(other);
		expect(r.allowed).toBe(true);
		await r.release();
		for (let i = 0; i < rl.MAX_FAILURES; i++)
			expect((await rl.reserveAttempt(other)).allowed).toBe(true);
		expect((await rl.reserveAttempt(other)).allowed).toBe(false);
		await rl.clearFailures(bucket);
		await rl.clearFailures(other);
	});

	it('verifies TOTP once (replay guard) and consumes recovery codes once', async () => {
		const sf = await import('./second-factor');
		const totp = await import('./totp');
		const rec = await import('./recovery');
		const key = totp.generateTotpKey();
		const { codes, hashes } = rec.generateRecoveryCodes();
		await db
			.update(t.admins)
			.set({ totpSecretEnc: sf.sealTotpKey(adminId, key), recoveryCodesHash: hashes })
			.where(eq(t.admins.id, adminId));

		const code = totp.totpCodeAt(key, Date.now());
		expect(await sf.verifySecondFactor(adminId, code)).toBe('totp');
		expect(await sf.verifySecondFactor(adminId, code)).toBeNull();

		expect(await sf.verifySecondFactor(adminId, codes[0])).toBe('recovery');
		expect(await sf.verifySecondFactor(adminId, codes[0])).toBeNull();
		const [a] = await db.select().from(t.admins).where(eq(t.admins.id, adminId));
		expect(a.recoveryCodesHash).toHaveLength(4);
	});
});
