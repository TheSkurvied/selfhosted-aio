/* eslint-disable @typescript-eslint/no-explicit-any -- mocks handle arbitrary upstream JSON */
/**
 * Self-test: the mocks answer each manager flow with the statuses upstream
 * returns, and with bodies shaped like the recorded real responses.
 *
 *   pnpm vitest run --config tests/mocks/vitest.config.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AIOMETADATA_MINIMAL_CONFIG, AIOSTREAMS_MINIMAL_CONFIG } from './configs.ts';
import { aiometadataFlow, aiostreamsAuthFlow, aiostreamsFlow, type Flow } from './flows.ts';
import { startAiostreamsMock, startMocks, type StartedMocks } from './index.ts';
import { runFlow, shapeDiff, type FixtureFile } from './runner.ts';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(flow: Flow): FixtureFile | null {
	const p = join(fixturesDir, flow.fixture);
	return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as FixtureFile) : null;
}

/** Parts of real responses that depend on the environment, not on behaviour. */
const IGNORE: Record<string, string[]> = {
	health_ready: ['$.components', '$.dependencies', '$.counters'],
	status: ['$.data'],
	create_invalid_config: ['$.error.message'],
	update_invalid_config: ['$.error.message'],
	me: ['$.data.permissions'],
	login: ['$.data.permissions']
};

async function checkFlow(flow: Flow, baseUrl: string) {
	const exchanges = await runFlow(flow, baseUrl);
	const statusDiffs = exchanges
		.filter((x) => x.response.status !== x.expectStatus)
		.map(
			(x) =>
				`${x.name}: ${x.response.status} != ${x.expectStatus} ${JSON.stringify(x.response.body)}`
		);
	expect(statusDiffs).toEqual([]);

	const fixture = loadFixture(flow);
	if (!fixture) return { exchanges, compared: 0 };
	const shapeDiffs: string[] = [];
	for (const real of fixture.exchanges) {
		const mock = exchanges.find((x) => x.name === real.name);
		if (!mock) {
			shapeDiffs.push(`${real.name}: step missing from flow`);
			continue;
		}
		if (mock.response.status !== real.response.status) {
			shapeDiffs.push(
				`${real.name}: status mock ${mock.response.status} real ${real.response.status}`
			);
		}
		for (const d of shapeDiff(real.response.body, mock.response.body, {
			ignore: IGNORE[real.name]
		})) {
			shapeDiffs.push(`${real.name}: ${d}`);
		}
	}
	expect(shapeDiffs).toEqual([]);
	return { exchanges, compared: fixture.exchanges.length };
}

describe('aiometadata mock', () => {
	let mocks: StartedMocks;
	beforeAll(async () => {
		mocks = await startMocks();
	});
	afterAll(() => mocks.stop());
	beforeEach(() => mocks.reset());

	it('matches the recorded real flow', async () => {
		const { compared } = await checkFlow(aiometadataFlow, mocks.aiometadataUrl);
		expect(compared).toBeGreaterThan(20);
	});

	it('adds lastModified, configVersion and configHash like upstream', async () => {
		const save = await post(mocks.aiometadataUrl + '/api/config/save', {
			config: AIOMETADATA_MINIMAL_CONFIG,
			password: 'pw',
			addonPassword: 'dev-addon-password'
		});
		const { userUUID, installUrl } = save.body;
		expect(installUrl).toBe(`${mocks.aiometadataUrl}/stremio/${userUUID}/manifest.json`);
		const load = await post(`${mocks.aiometadataUrl}/api/config/load/${userUUID}`, {
			password: 'pw'
		});
		const cfg = load.body.config;
		expect(Object.keys(cfg)).toEqual([
			'language',
			'apiKeys',
			'lastModified',
			'configVersion',
			'configHash'
		]);
		const { configHash, ...rest } = cfg;
		expect(configHash).toBe(
			createHash('md5').update(JSON.stringify(rest)).digest('hex').slice(0, 16)
		);
	});

	it('injects faults: 500, reset and hang', async () => {
		const st = mocks.state.aiometadata;
		st.faults.inject({ status: 500, body: { error: 'boom' } });
		expect((await fetch(mocks.aiometadataUrl + '/health/live')).status).toBe(500);
		expect((await fetch(mocks.aiometadataUrl + '/health/live')).status).toBe(200);

		st.faults.inject({ reset: true });
		await expect(fetch(mocks.aiometadataUrl + '/health/live')).rejects.toThrow();

		st.faults.inject({ hang: true }, { match: { pathPrefix: '/api/admin' } });
		await expect(
			fetch(mocks.aiometadataUrl + '/api/admin/users', {
				headers: { 'x-admin-key': 'dev-admin-key' },
				signal: AbortSignal.timeout(200)
			})
		).rejects.toThrow();
		expect(st.faults.pending).toBe(0);
	});
});

describe('aiostreams mock', () => {
	let mocks: StartedMocks;
	beforeAll(async () => {
		mocks = await startMocks();
	});
	afterAll(() => mocks.stop());
	beforeEach(() => mocks.reset());

	it('runs the manager flow with upstream status codes (and matches fixtures when recorded)', async () => {
		await checkFlow(aiostreamsFlow, mocks.aiostreamsUrl);
	});

	it('normalizes the stored config like validateConfig', async () => {
		const create = await post(mocks.aiostreamsUrl + '/api/v1/user', {
			config: {
				...AIOSTREAMS_MINIMAL_CONFIG,
				notAField: 1,
				ip: '1.2.3.4',
				healthResults: { a: true }
			},
			password: 'secret-pw'
		});
		expect(create.status).toBe(201);
		const { uuid, encryptedPassword } = create.body.data;
		const read = await fetch(mocks.aiostreamsUrl + '/api/v1/user?raw=true', {
			headers: { authorization: 'Basic ' + Buffer.from(`${uuid}:secret-pw`).toString('base64') }
		});
		const { data } = await read.json();
		expect(data.userData).toEqual({
			...AIOSTREAMS_MINIMAL_CONFIG,
			trusted: false,
			checkOwned: true,
			proxy: {},
			uuid
		});
		// every read returns a fresh segment; each decrypts to the same password
		expect(data.encryptedPassword).not.toBe(encryptedPassword);
		expect(mocks.aiostreams.decrypt(data.encryptedPassword)).toBe('secret-pw');
		const manifest = await fetch(
			`${mocks.aiostreamsUrl}/stremio/${uuid}/${encryptedPassword}/manifest.json`
		);
		expect(manifest.status).toBe(200);
	});

	it('simulates the upstream rate limits when enabled', async () => {
		mocks.state.aiostreams.rateLimit.enabled = true;
		const statuses: number[] = [];
		let last: Response | undefined;
		for (let i = 0; i < 6; i++) {
			last = await fetch(mocks.aiostreamsUrl + '/api/v1/user?uuid=x', { method: 'HEAD' });
			statuses.push(last.status);
		}
		expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
		expect(last?.headers.get('retry-after')).toBeTruthy();
		mocks.state.aiostreams.rateLimit.enabled = false;
	});

	it('fails validation for an unreachable addon', async () => {
		mocks.state.aiostreams.brokenPresetTypes.add('torrentio');
		const res = await post(mocks.aiostreamsUrl + '/api/v1/user', {
			config: {
				...AIOSTREAMS_MINIMAL_CONFIG,
				presets: [{ type: 'torrentio', instanceId: 't1', enabled: true, options: {} }]
			},
			password: 'secret-pw'
		});
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe('USER_INVALID_CONFIG');
	});

	it('redirects dashboard calls without Accept: application/json', async () => {
		const res = await fetch(mocks.aiostreamsUrl + '/api/v1/dashboard/users', {
			redirect: 'manual'
		});
		expect(res.status).toBe(302);
	});
});

describe('aiostreams mock with AIOSTREAMS_AUTH_REQUIRED=true', () => {
	it('gates writes behind a login session', async () => {
		const mock = await startAiostreamsMock({ authRequired: true });
		try {
			await checkFlow(aiostreamsAuthFlow, mock.url);
		} finally {
			await mock.stop();
		}
	});
});

async function post(url: string, body: unknown) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return { status: res.status, body: (await res.json()) as any };
}
