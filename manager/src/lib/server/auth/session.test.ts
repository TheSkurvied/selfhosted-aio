import { describe, expect, it } from 'vitest';
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, TOUCH_INTERVAL_MS, sessionStatus } from './session';
import { MAX_FAILURES, WINDOW_MS, isBlocked } from './ratelimit';

const H = 60 * 60 * 1000;

describe('session expiry', () => {
	const created = new Date('2026-01-01T00:00:00Z');
	const base = {
		createdAt: created,
		expiresAt: new Date(created.getTime() + ABSOLUTE_TIMEOUT_MS),
		lastSeenAt: created
	};

	it('is valid right after creation without touching', () => {
		const s = sessionStatus(base, new Date(created.getTime() + 1000));
		expect(s).toMatchObject({ valid: true, touch: false });
	});

	it('touches after the touch interval and slides the cookie expiry', () => {
		const now = new Date(created.getTime() + TOUCH_INTERVAL_MS + 1);
		const s = sessionStatus(base, now);
		expect(s.valid && s.touch).toBe(true);
		if (s.valid) expect(s.cookieExpires.getTime()).toBe(now.getTime() + IDLE_TIMEOUT_MS);
	});

	it('expires after 12h idle', () => {
		expect(sessionStatus(base, new Date(created.getTime() + 12 * H)).valid).toBe(false);
		expect(sessionStatus(base, new Date(created.getTime() + 11.9 * H)).valid).toBe(true);
	});

	it('expires after 7 days even when active', () => {
		const at = new Date(created.getTime() + ABSOLUTE_TIMEOUT_MS);
		expect(sessionStatus({ ...base, lastSeenAt: new Date(at.getTime() - 1000) }, at).valid).toBe(
			false
		);
	});

	it('caps the cookie expiry at the absolute expiry', () => {
		const now = new Date(base.expiresAt.getTime() - H);
		const s = sessionStatus({ ...base, lastSeenAt: new Date(now.getTime() - 2 * H) }, now);
		expect(s.valid).toBe(true);
		if (s.valid) expect(s.cookieExpires.getTime()).toBe(base.expiresAt.getTime());
	});
});

describe('rate limit window', () => {
	const now = new Date('2026-01-01T12:00:00Z');
	const ago = (ms: number) => new Date(now.getTime() - ms);

	it('blocks at 5 failures within 15 minutes', () => {
		const f = Array.from({ length: MAX_FAILURES }, (_, i) => ago(i * 60_000));
		expect(isBlocked(f, now)).toBe(true);
		expect(isBlocked(f.slice(1), now)).toBe(false);
	});

	it('ignores failures older than the window', () => {
		const f = Array.from({ length: MAX_FAILURES }, () => ago(WINDOW_MS + 1));
		expect(isBlocked(f, now)).toBe(false);
	});
});
