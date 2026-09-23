import { describe, expect, it } from 'vitest';
import { isCrossOriginMutation } from './request';

const url = new URL('https://manage.example.com/api/sync/check-all');
const req = (method: string, headers: Record<string, string> = {}) =>
	new Request(url, { method, headers });

describe('isCrossOriginMutation', () => {
	it('blocks non-GET requests from another origin, including same-site subdomains', () => {
		// a no-cors POST with a Blob body carries no Content-Type, so SvelteKit's form check skips it
		expect(isCrossOriginMutation(req('POST', { origin: 'https://streams.example.com' }), url)).toBe(
			true
		);
		expect(isCrossOriginMutation(req('DELETE', { origin: 'https://evil.test' }), url)).toBe(true);
		expect(isCrossOriginMutation(req('PUT', { origin: 'null' }), url)).toBe(true);
		expect(isCrossOriginMutation(req('POST', { 'sec-fetch-site': 'same-site' }), url)).toBe(true);
	});

	it('allows same-origin, safe methods and non-browser clients', () => {
		expect(isCrossOriginMutation(req('POST', { origin: 'https://manage.example.com' }), url)).toBe(
			false
		);
		expect(isCrossOriginMutation(req('GET', { origin: 'https://evil.test' }), url)).toBe(false);
		expect(isCrossOriginMutation(req('POST'), url)).toBe(false);
		expect(isCrossOriginMutation(req('POST', { 'sec-fetch-site': 'same-origin' }), url)).toBe(
			false
		);
	});
});
