import { describe, expect, it } from 'vitest';
import { redact } from './log';

describe('log redaction', () => {
	it('redacts sensitive keys at any depth', () => {
		const out = redact({
			user: 'bob',
			password: 'p',
			nested: { apiKey: 'k', list: [{ token: 't', ok: 1 }] },
			AIOMETADATA_ADMIN_KEY: 'x'
		});
		expect(out).toEqual({
			user: 'bob',
			password: '[redacted]',
			nested: { apiKey: '[redacted]', list: [{ token: '[redacted]', ok: 1 }] },
			AIOMETADATA_ADMIN_KEY: '[redacted]'
		});
	});
});
