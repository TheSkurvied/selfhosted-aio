/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into untyped JSON */
import { describe, expect, it } from 'vitest';
import { useTestEnv } from '../testing';
import {
	applyExtraction,
	applyMergePatch,
	configHash,
	createMergePatch,
	deepEqual,
	diffPaths,
	extractSecrets,
	formatPath,
	isCredentialPath,
	maskConfig,
	outgoing,
	parsePath,
	render,
	requiredSecrets,
	strip,
	substitutePlaceholders,
	validateTemplateBody
} from './index';

useTestEnv();

describe('merge patch (RFC 7386)', () => {
	// Test cases from RFC 7386 appendix A
	const cases: Array<[unknown, unknown, unknown]> = [
		[{ a: 'b' }, { a: 'c' }, { a: 'c' }],
		[{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
		[{ a: 'b' }, { a: null }, {}],
		[{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
		[{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
		[{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
		[{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
		[{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
		[
			['a', 'b'],
			['c', 'd'],
			['c', 'd']
		],
		[{ a: 'b' }, ['c'], ['c']],
		[{ a: 'foo' }, null, null],
		[{ a: 'foo' }, 'bar', 'bar'],
		[{ e: null }, { a: 1 }, { e: null, a: 1 }],
		[[1, 2], { a: 'b', c: null }, { a: 'b' }],
		[{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }]
	];
	it.each(cases)('apply %j + %j', (target, patch, expected) => {
		expect(applyMergePatch(target, patch)).toEqual(expected);
	});

	it('does not mutate inputs', () => {
		const base = { a: { b: 1 } };
		const patch = { a: { c: 2 } };
		applyMergePatch(base, patch);
		expect(base).toEqual({ a: { b: 1 } });
		expect(patch).toEqual({ a: { c: 2 } });
	});

	it('createMergePatch round-trips', () => {
		const base = { a: 1, b: { c: 2, d: [1, 2] }, e: 'x', gone: true };
		const target = { a: 1, b: { c: 3, d: [1, 2, 3], n: { deep: 1 } }, e: 'x', added: 'y' };
		const patch = createMergePatch(base, target);
		expect(patch).toEqual({ b: { c: 3, d: [1, 2, 3], n: { deep: 1 } }, gone: null, added: 'y' });
		expect(applyMergePatch(base, patch)).toEqual(target);
	});

	it('createMergePatch of equal objects is empty', () => {
		expect(createMergePatch({ a: { b: [1] } }, { a: { b: [1] } })).toEqual({});
	});

	it('deepEqual ignores key order and undefined', () => {
		expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
		expect(deepEqual({ a: [1, { x: 1 }] }, { a: [1, { x: 2 }] })).toBe(false);
	});
});

describe('placeholders', () => {
	const secrets: Record<string, string> = { rd_key: 'RDSECRET123', 'tb.key': 'TB-9999' };
	const lookup = (n: string) => secrets[n];

	it('substitutes whole strings and embedded occurrences', () => {
		const body = {
			a: '{{secret:rd_key}}',
			b: 'Bearer {{secret:rd_key}} and {{ secret:tb.key }}',
			c: ['{{secret:tb.key}}', 5, true, null],
			d: { nested: '{{secret:rd_key}}' }
		};
		const r = substitutePlaceholders(body, lookup);
		expect(r.missing).toEqual([]);
		expect(r.value).toEqual({
			a: 'RDSECRET123',
			b: 'Bearer RDSECRET123 and TB-9999',
			c: ['TB-9999', 5, true, null],
			d: { nested: 'RDSECRET123' }
		});
		expect(body.a).toBe('{{secret:rd_key}}');
	});

	it('reports missing secrets and leaves them in place', () => {
		const r = substitutePlaceholders(
			{ a: '{{secret:nope}}', b: '{{secret:rd_key}}', c: '{{secret:nope}}' },
			lookup
		);
		expect(r.missing).toEqual(['nope']);
		expect((r.value as Record<string, string>).a).toBe('{{secret:nope}}');
	});

	it('does not treat $ patterns in values specially', () => {
		const r = substitutePlaceholders({ a: 'x{{secret:k}}' }, () => '$&$1$$');
		expect(r.value).toEqual({ a: 'x$&$1$$' });
	});

	it('extracts required secret names', () => {
		expect(
			requiredSecrets({
				a: '{{secret:b}}',
				x: ['{{secret:a}} {{secret:b}}'],
				k: { '{{secret:key}}': 1 }
			})
		).toEqual(['a', 'b']);
	});
});

describe('strip + hash', () => {
	it('drops AIOStreams normalized fields and defaults', () => {
		const remote = {
			uuid: 'u',
			trusted: false,
			checkOwned: true,
			proxy: {},
			presets: [],
			formatter: { id: 'gdrive' },
			sortCriteria: { global: [] }
		};
		const desired = { presets: [], formatter: { id: 'gdrive' }, sortCriteria: { global: [] } };
		expect(strip('aiostreams', remote)).toEqual(desired);
		expect(configHash('aiostreams', remote)).toBe(configHash('aiostreams', desired));
	});

	it('keeps non-default checkOwned and proxy', () => {
		expect(strip('aiostreams', { checkOwned: false, proxy: { enabled: true } })).toEqual({
			checkOwned: false,
			proxy: { enabled: true }
		});
	});

	it('drops AIOMetadata normalized fields', () => {
		const remote = {
			language: 'en-US',
			apiKeys: { tmdb: 'k' },
			lastModified: 1,
			configVersion: 2,
			configHash: 'abc'
		};
		expect(configHash('aiometadata', remote)).toBe(
			configHash('aiometadata', { apiKeys: { tmdb: 'k' }, language: 'en-US' })
		);
	});

	it('hash is key-order independent and value sensitive', () => {
		expect(configHash('aiometadata', { a: 1, b: { c: 2, d: 3 } })).toBe(
			configHash('aiometadata', { b: { d: 3, c: 2 }, a: 1 })
		);
		expect(configHash('aiometadata', { a: 1 })).not.toBe(configHash('aiometadata', { a: 2 }));
	});

	it('outgoing never sends userUUID or uuid', () => {
		expect(outgoing('aiometadata', { userUUID: 'x', a: 1 })).toEqual({ a: 1 });
		expect(outgoing('aiostreams', { uuid: 'x', accessKey: 'y', a: 1 })).toEqual({ a: 1 });
	});
});

describe('masking', () => {
	it('replaces known secret values (whole and embedded) with hints', () => {
		const m = maskConfig({ a: 'RDSECRET123', b: 'url?key=RDSECRET123&x=1', c: 'plain', n: 5 }, [
			'RDSECRET123'
		]);
		expect(m).toEqual({ a: '••••T123', b: 'url?key=••••T123&x=1', c: 'plain', n: 5 });
	});

	it('masks any value at credential-like paths', () => {
		const m = maskConfig({
			services: [{ id: 'realdebrid', credentials: { apiKey: 'abcdefgh' } }],
			apiKeys: { tmdb: 'tmdbkey1', fanart: '' },
			rpdbApiKey: 'rpdb1234',
			tmdbAccessToken: 'tok12345',
			sortCriteria: { global: [{ key: 'cached', direction: 'desc' }] },
			password: 'hunter22',
			placeholder: { apiKey: '{{secret:x}}' }
		}) as Record<string, any>;
		expect(m.services[0].credentials.apiKey).toBe('••••efgh');
		expect(m.services[0].id).toBe('realdebrid');
		expect(m.apiKeys.tmdb).toBe('••••key1');
		expect(m.apiKeys.fanart).toBe('');
		expect(m.rpdbApiKey).toBe('••••1234');
		expect(m.tmdbAccessToken).toBe('••••2345');
		expect(m.sortCriteria.global[0].key).toBe('cached');
		expect(m.password).toBe('••••er22');
		expect(m.placeholder.apiKey).toBe('{{secret:x}}');
	});

	it('isCredentialPath', () => {
		expect(isCredentialPath(['services', 0, 'credentials', 'email'])).toBe(true);
		expect(isCredentialPath(['sortCriteria', 'global', 0, 'key'])).toBe(false);
		expect(isCredentialPath(['addonName'])).toBe(false);
	});
});

describe('paths', () => {
	it('format/parse round-trip', () => {
		const segs = ['services', 0, 'credentials', 'api key', 'x.y', 'plain'];
		const p = formatPath(segs);
		expect(p).toBe('services[0].credentials["api key"]["x.y"].plain');
		expect(parsePath(p)).toEqual(segs);
		expect(parsePath('')).toEqual([]);
		expect(parsePath('[2].a')).toEqual([2, 'a']);
	});
});

describe('diffPaths', () => {
	it('reports added/removed/changed without values', () => {
		const a = { x: 1, y: { z: [1, 2, 3] }, gone: 'secret-value', same: { k: 1 } };
		const b = { x: 2, y: { z: [1, 5] }, added: 'other-secret', same: { k: 1 } };
		const d = diffPaths(a, b);
		expect(d).toEqual([
			{ path: 'added', kind: 'added' },
			{ path: 'gone', kind: 'removed' },
			{ path: 'x', kind: 'changed' },
			{ path: 'y.z[1]', kind: 'changed' },
			{ path: 'y.z[2]', kind: 'removed' }
		]);
		expect(JSON.stringify(d)).not.toContain('secret');
	});

	it('type changes are "changed"', () => {
		expect(diffPaths({ a: [1] }, { a: { 0: 1 } })).toEqual([{ path: 'a', kind: 'changed' }]);
		expect(diffPaths(1, 2)).toEqual([{ path: '(root)', kind: 'changed' }]);
		expect(diffPaths({ a: 1 }, { a: 1 })).toEqual([]);
	});
});

describe('extractSecrets / applyExtraction', () => {
	it('finds credentials and suggests names', () => {
		const body = {
			services: [
				{ id: 'realdebrid', enabled: true, credentials: { apiKey: 'RDKEY-123456' } },
				{ id: 'torbox', enabled: true, credentials: { apiKey: '{{secret:tb}}' } }
			],
			apiKeys: { tmdb: 'TMDBKEY999', tvdb: '' },
			rpdbApiKey: 'RPDB-0000',
			formatter: { id: 'gdrive' },
			presets: [{ type: 'torrentio', options: { debridApiKey: 'RDKEY-123456' } }]
		};
		const r = extractSecrets(body);
		expect(r.found.map((f) => [f.path, f.suggestedName])).toEqual([
			['services[0].credentials.apiKey', 'realdebrid_api_key'],
			['apiKeys.tmdb', 'tmdb_api_key'],
			['rpdbApiKey', 'rpdb_api_key'],
			// same value reuses the same name
			['presets[0].options.debridApiKey', 'realdebrid_api_key']
		]);
		expect(r.found[0].hint).toBe('••••3456');
		expect(r.found[0].value).toBe('RDKEY-123456');
		const out = r.body as any;
		expect(out.services[0].credentials.apiKey).toBe('{{secret:realdebrid_api_key}}');
		expect(out.services[1].credentials.apiKey).toBe('{{secret:tb}}');
		expect(out.apiKeys.tmdb).toBe('{{secret:tmdb_api_key}}');
		expect(out.formatter.id).toBe('gdrive');
		expect(body.services[0].credentials.apiKey).toBe('RDKEY-123456');
	});

	it('de-duplicates names for different values', () => {
		const r = extractSecrets({
			a: { credentials: { apiKey: 'AAAA1' } },
			b: { credentials: { apiKey: 'BBBB2' } }
		});
		expect(r.found.map((f) => f.suggestedName)).toEqual(['a_api_key', 'b_api_key']);
		const r2 = extractSecrets({
			x: [{ credentials: { token: 'AAAA1' } }, { credentials: { token: 'BBBB2' } }]
		});
		expect(r2.found.map((f) => f.suggestedName)).toEqual(['x_0_token', 'x_1_token']);
	});

	it('applyExtraction replaces only picked string paths', () => {
		const out = applyExtraction({ a: { key: 'v1' }, b: 'v2', c: 3 }, [
			{ path: 'a.key', name: 'k1' },
			{ path: 'c', name: 'k2' },
			{ path: 'nope.x', name: 'k3' }
		]) as any;
		expect(out).toEqual({ a: { key: '{{secret:k1}}' }, b: 'v2', c: 3 });
		expect(() => applyExtraction({ a: 'x' }, [{ path: 'a', name: 'bad name!' }])).toThrow();
	});
});

describe('validateTemplateBody', () => {
	it('accepts the minimal configs', () => {
		expect(
			validateTemplateBody('aiostreams', {
				presets: [],
				formatter: { id: 'gdrive' },
				sortCriteria: { global: [] }
			})
		).toEqual({ ok: true, errors: [] });
		expect(
			validateTemplateBody('aiometadata', { language: 'en-US', apiKeys: { tmdb: 'x' } })
		).toEqual({
			ok: true,
			errors: []
		});
	});

	it('catches obvious AIOStreams errors', () => {
		const r = validateTemplateBody('aiostreams', {
			formatter: { id: 'nope' },
			presets: {},
			uuid: 'x',
			services: [
				{ id: 'realdebrid', credentials: {} },
				{ id: 'torbox', enabled: false }
			]
		});
		expect(r.ok).toBe(false);
		expect(r.errors.join('\n')).toMatch(/formatter/);
		expect(r.errors.join('\n')).toMatch(/sortCriteria/);
		expect(r.errors.join('\n')).toMatch(/presets/);
		expect(r.errors.join('\n')).toMatch(/uuid/);
	});

	it('requires credentials on enabled services', () => {
		const r = validateTemplateBody('aiostreams', {
			formatter: { id: 'gdrive' },
			presets: [],
			sortCriteria: { global: [] },
			services: [
				{ id: 'realdebrid', credentials: { apiKey: '' } },
				{ id: 'torbox', enabled: false }
			]
		});
		expect(r.errors).toEqual(['services[0].credentials: an enabled service needs credentials']);
	});

	it('catches AIOMetadata errors', () => {
		expect(validateTemplateBody('aiometadata', { userUUID: 'x' }).ok).toBe(false);
		expect(validateTemplateBody('aiometadata', { apiKeys: 'x' }).ok).toBe(false);
		expect(validateTemplateBody('aiometadata', [] as unknown).ok).toBe(false);
	});
});

describe('render', () => {
	it('merges, substitutes, validates and hashes', () => {
		const base = {
			presets: [],
			formatter: { id: 'gdrive' },
			sortCriteria: { global: [] },
			services: [{ id: 'realdebrid', credentials: { apiKey: '{{secret:rd}}' } }]
		};
		const r = render({
			kind: 'aiostreams',
			base,
			overrides: { addonName: 'Bob' },
			lookup: (n) => (n === 'rd' ? 'RDKEY' : undefined)
		});
		expect(r.missingSecrets).toEqual([]);
		expect(r.errors).toEqual([]);
		expect((r.resolved as any).services[0].credentials.apiKey).toBe('RDKEY');
		expect((r.merged as any).services[0].credentials.apiKey).toBe('{{secret:rd}}');
		expect(r.resolved.addonName).toBe('Bob');
		expect(r.desiredHash).toBe(configHash('aiostreams', r.resolved));

		const missing = render({ kind: 'aiostreams', base, overrides: {}, lookup: () => undefined });
		expect(missing.missingSecrets).toEqual(['rd']);
	});
});
