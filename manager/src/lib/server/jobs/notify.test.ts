import { describe, expect, it } from 'vitest';
import { headerValue } from './notify';

describe('headerValue', () => {
	it('leaves plain ASCII alone', () => {
		expect(headerValue('Drift: Uncle Joe')).toBe('Drift: Uncle Joe');
	});

	it('encodes non-ASCII names so the header stays valid', () => {
		const v = headerValue('Drift: Zoë 李');
		expect(v).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
		expect(() => new Headers({ title: v })).not.toThrow();
		expect(Buffer.from(v.slice(10, -2), 'base64').toString('utf8')).toBe('Drift: Zoë 李');
	});

	it('strips CR/LF', () => {
		expect(headerValue('a\r\nb')).toBe('a b');
	});
});
