/**
 * AIOStreams auth-required login path, 429 handling and the client-side throttle.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mockEnv, startMocks, type StartedMocks } from '../mocks/index.ts';
import {
	ADMIN_ID,
	AIOSTREAMS_RD_TEMPLATE,
	ensureTestDatabase,
	startEngine,
	type Engine
} from './helpers';

const dbUrl = await ensureTestDatabase('limits');
const A = ADMIN_ID;

describe.skipIf(!dbUrl)('AIOStreams auth, rate limits and retries', () => {
	let mocks: StartedMocks;
	let e: Engine;

	beforeAll(async () => {
		mocks = await startMocks({ aiostreams: { authRequired: true } });
		e = await startEngine({ ...mockEnv(mocks), AIOSTREAMS_USER_API_LIMIT: 'off' }, dbUrl!);
	});

	afterAll(async () => {
		await e?.close();
		await mocks?.stop();
	});

	beforeEach(async () => {
		mocks.reset();
		mocks.state.aiostreams.authRequired = true;
		mocks.state.aiostreams.accounts = { manager: 'managerpass' };
		delete process.env.AIOSTREAMS_USER_API_LIMIT;
		process.env.AIOSTREAMS_USER_API_LIMIT = 'off';
		await e.reset();
	});

	async function person(name: string) {
		const existing = (await e.s.listTemplates()).find((x) => x.name === 'streams');
		const tpl =
			existing ??
			(await e.s.createTemplate(A, {
				name: 'streams',
				kind: 'aiostreams',
				body: AIOSTREAMS_RD_TEMPLATE
			}));
		const { id } = await e.s.createPerson(A, { displayName: name });
		await e.s.setSecret(A, 'person', id, 'rd_key', `RDKEY-${name}-0000`);
		await e.s.setBinding(A, id, 'aiostreams', {
			templateId: tpl.id,
			pinnedVersionId: null,
			overrides: {}
		});
		return id;
	}

	const logins = () =>
		mocks.state.aiostreams.requests.filter((r) => r.path === '/api/v1/auth/login').length;

	it('logs in when auth is required and again after the session expires', async () => {
		const id = await person('Dana');
		const { jobId } = await e.s.pushBinding(A, id, 'aiostreams');
		const [job] = await e.wait(jobId);
		expect(job.status, job.error ?? '').toBe('done');
		expect(logins()).toBe(1);
		// accessKey is injected upstream but never part of our hashes
		const b = await e.core.requireBinding(id, 'aiostreams');
		const acc = (await e.core.activeAccount(b.id))!;
		expect(mocks.state.aiostreams.users.get(acc.remoteUuid!)!.config.accessKey).toBeTruthy();
		expect((await e.s.getPerson(id)).bindings.aiostreams?.status).toBe('in_sync');

		// server-side sessions vanish (restart / expiry): the next write re-logs in once
		mocks.state.aiostreams.sessions.clear();
		await e.s.setSecret(A, 'person', id, 'rd_key', 'RDKEY-Dana-1111');
		const again = await e.s.pushBinding(A, id, 'aiostreams');
		const [job2] = await e.wait(again.jobId);
		expect(job2.status, job2.error ?? '').toBe('done');
		expect(logins()).toBe(2);
		expect((await e.s.getPerson(id)).bindings.aiostreams?.status).toBe('in_sync');

		// the dashboard (orphan report) uses the same session
		mocks.state.aiostreams.users.set('orphan-uuid', {
			...mocks.state.aiostreams.users.get(acc.remoteUuid!)!,
			uuid: 'orphan-uuid'
		});
		const orphans = await e.s.orphanReport();
		expect(orphans.map((o) => o.uuid)).toEqual(['orphan-uuid']);
	});

	it('does not loop on logins when credentials are rejected', async () => {
		mocks.state.aiostreams.accounts = { manager: 'something-else' };
		const id = await person('Eve');
		const { jobId } = await e.s.pushBinding(A, id, 'aiostreams');
		const [job] = await e.wait(jobId);
		expect(job.status).toBe('failed');
		expect(job.error).toMatch(/manager login rejected/);
		expect(job.error).not.toContain('managerpass');
		expect(job.attempts).toBe(1);
		const second = await e.s.pushBinding(A, id, 'aiostreams');
		await e.wait(second.jobId);
		expect(logins()).toBe(1); // cooldown: no second login attempt right away
		expect((await e.s.getPerson(id)).bindings.aiostreams?.status).toBe('error');
	});

	it('retries 429 responses in place and then as a job', async () => {
		const id = await person('Finn');
		const first = await e.s.pushBinding(A, id, 'aiostreams');
		await e.wait(first.jobId);
		const reads = () =>
			mocks.state.aiostreams.requests.filter((r) => r.method === 'GET' && r.path === '/api/v1/user')
				.length;

		// one 429: absorbed by the adapter
		let before = reads();
		mocks.state.aiostreams.faults.inject(
			{ status: 429, body: { error: { code: 'RATE_LIMIT_EXCEEDED' } } },
			{ match: { method: 'GET', pathPrefix: '/api/v1/user' } }
		);
		const c1 = await e.s.checkBinding(A, id, 'aiostreams');
		const [j1] = await e.wait(c1.jobId);
		expect(j1.status, j1.error ?? '').toBe('done');
		expect(j1.attempts).toBe(1);
		expect(reads() - before).toBe(2);

		// three 429s: the adapter gives up, the job is retried with backoff
		before = reads();
		mocks.state.aiostreams.faults.inject(
			{ status: 429 },
			{ times: 3, match: { method: 'GET', pathPrefix: '/api/v1/user' } }
		);
		const c2 = await e.s.checkBinding(A, id, 'aiostreams');
		const [j2] = await e.wait(c2.jobId, 30_000);
		expect(j2.status, j2.error ?? '').toBe('done');
		expect(j2.attempts).toBe(2);
		expect(reads() - before).toBe(4);
		expect((await e.s.getPerson(id)).bindings.aiostreams?.status).toBe('in_sync');
	}, 30_000);

	it('transient failures are retried up to 3 attempts, then fail', async () => {
		const id = await person('Gus');
		mocks.state.aiostreams.faults.inject(
			{ status: 502 },
			{ times: 10, match: { method: 'POST', pathPrefix: '/api/v1/user' } }
		);
		const { jobId } = await e.s.pushBinding(A, id, 'aiostreams');
		const [job] = await e.wait(jobId, 20_000);
		expect(job.status).toBe('failed');
		expect(job.attempts).toBe(3);
		expect((await e.s.getPerson(id)).bindings.aiostreams?.status).toBe('error');
		mocks.state.aiostreams.faults.clear();
		const retry = await e.s.pushBinding(A, id, 'aiostreams');
		const [ok] = await e.wait(retry.jobId);
		expect(ok.status, ok.error ?? '').toBe('done');
		expect((await e.s.getPerson(id)).bindings.aiostreams?.status).toBe('in_sync');
	}, 30_000);

	it('the default client throttle keeps under the upstream 5 per 5 s user API limit', async () => {
		mocks.state.aiostreams.rateLimit.enabled = true;
		mocks.state.aiostreams.rateLimit.login = { max: 100, windowMs: 300_000 };
		delete process.env.AIOSTREAMS_USER_API_LIMIT; // default 5/5s
		e.adapters.resetAdapters();
		const ids = [await person('H1'), await person('H2'), await person('H3')];
		const started = Date.now();
		const { jobIds } = await e.s.bulk(A, 'push', ids);
		const rows = await e.wait(jobIds, 40_000);
		for (const r of rows) {
			expect(r.status, r.error ?? '').toBe('done');
			expect(r.attempts).toBe(1);
		}
		// 3 creates + 3 read-backs = 6 user API calls: the 6th had to wait
		expect(Date.now() - started).toBeGreaterThan(4000);
	}, 45_000);
});
