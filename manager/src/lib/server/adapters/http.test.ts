import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiometadataAdapter } from './aiometadata';
import { AiostreamsAdapter } from './aiostreams';
import {
	httpRequest,
	parseRateSpec,
	parseRetryAfter,
	sanitize,
	Throttle,
	UpstreamError
} from './http';

describe('sanitize', () => {
	it('removes scrub values, auth headers and caps length', () => {
		expect(sanitize('bad key SECRET123 in body', ['SECRET123'])).toBe('bad key [redacted] in body');
		expect(sanitize('Authorization: Basic dXVpZDpwYXNzd29yZA==')).toBe('Authorization: [redacted]');
		expect(sanitize('sent Bearer abcdefghijklmnop')).toBe('sent Bearer [redacted]');
		expect(sanitize('x'.repeat(500)).length).toBe(300);
		expect(sanitize('short abc', ['abc'])).toBe('short abc'); // too short to scrub safely
	});
});

describe('parseRetryAfter / parseRateSpec', () => {
	it('parses seconds and dates', () => {
		expect(parseRetryAfter('3')).toBe(3000);
		expect(parseRetryAfter(null)).toBeUndefined();
		const now = Date.parse('2026-01-01T00:00:00Z');
		expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
		expect(parseRetryAfter('soon')).toBeUndefined();
	});
	it('parses rate specs', () => {
		expect(parseRateSpec('5/5', { max: 1, windowMs: 1 })).toEqual({ max: 5, windowMs: 5000 });
		expect(parseRateSpec('off', { max: 1, windowMs: 1 })).toEqual({ max: 0, windowMs: 0 });
		expect(parseRateSpec('bogus', { max: 1, windowMs: 1 })).toEqual({ max: 1, windowMs: 1 });
		expect(parseRateSpec(undefined, { max: 1, windowMs: 1 })).toEqual({ max: 1, windowMs: 1 });
	});
});

describe('Throttle', () => {
	it('allows max per window, then waits', async () => {
		const th = new Throttle(2, 200);
		const t0 = Date.now();
		await th.acquire();
		await th.acquire();
		expect(Date.now() - t0).toBeLessThan(100);
		await th.acquire();
		expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
	});
});

describe('httpRequest', () => {
	let url = '';
	let hits = 0;
	const server = createServer((req, res) => {
		hits++;
		if (req.url === '/429-once' && hits === 1) {
			res.writeHead(429, { 'retry-after': '0' });
			res.end('{}');
			return;
		}
		if (req.url === '/hang') return; // never answers
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: true, url: req.url }));
	});
	beforeAll(async () => {
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterAll(async () => {
		server.closeAllConnections();
		await new Promise((r) => server.close(r));
	});

	it('retries a 429 honouring Retry-After', async () => {
		hits = 0;
		const r = await httpRequest({
			kind: 'aiostreams',
			op: 't',
			baseUrl: url,
			method: 'GET',
			path: '/429-once'
		});
		expect(r.status).toBe(200);
		expect(hits).toBe(2);
	});

	it('times out with a transient error', async () => {
		const err = await httpRequest({
			kind: 'aiometadata',
			op: 'read',
			baseUrl: url,
			method: 'GET',
			path: '/hang',
			timeoutMs: 100
		}).catch((e) => e);
		expect(err).toBeInstanceOf(UpstreamError);
		expect(err.code).toBe('timeout');
		expect(err.transient).toBe(true);
	});

	it('reports unreachable hosts as network errors', async () => {
		const err = await httpRequest({
			kind: 'aiometadata',
			op: 'x',
			baseUrl: 'http://127.0.0.1:1',
			method: 'GET',
			path: '/'
		}).catch((e) => e);
		expect(err.code).toBe('network');
		expect(err.message).toMatch(/unreachable/);
	});
});

describe('manifest URLs use the public base', () => {
	it('AIOStreams', () => {
		const a = new AiostreamsAdapter({
			internalUrl: 'http://aiostreams:3000',
			publicUrl: 'https://streams.example.com/'
		});
		expect(a.manifestUrl('u-1', 'seg/+=')).toBe(
			'https://streams.example.com/stremio/u-1/seg%2F%2B%3D/manifest.json'
		);
	});
	it('AIOMetadata rebases installUrl onto the public URL', () => {
		const a = new AiometadataAdapter({
			internalUrl: 'http://aiometadata:3232',
			publicUrl: 'https://meta.example.com',
			adminKey: 'k'
		});
		expect(a.publicInstallUrl('u', 'http://aiometadata:3232/stremio/alias-x/manifest.json')).toBe(
			'https://meta.example.com/stremio/alias-x/manifest.json'
		);
		expect(a.publicInstallUrl('u', 'https://meta.example.com/stremio/u/manifest.json')).toBe(
			'https://meta.example.com/stremio/u/manifest.json'
		);
		expect(a.publicInstallUrl('u', undefined)).toBe(
			'https://meta.example.com/stremio/u/manifest.json'
		);
	});
});
