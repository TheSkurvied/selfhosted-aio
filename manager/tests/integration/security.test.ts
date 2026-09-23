/**
 * Regression tests from the security review: revoke and rotate must never
 * leave a live upstream config (holding a person's debrid keys) behind.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mockEnv, startMocks, type StartedMocks } from '../mocks/index.ts';
import {
	ADMIN_ID,
	AIOMETADATA_TEMPLATE,
	captureOutput,
	ensureTestDatabase,
	startEngine,
	type Engine
} from './helpers';

const dbUrl = await ensureTestDatabase('security');
const TMDB_KEY = 'TMDB-SHARED-KEY-deadbeef1234';

describe.skipIf(!dbUrl)('revoke/rotate leave no live upstream configs', () => {
	let mocks: StartedMocks;
	let e: Engine;
	let out: ReturnType<typeof captureOutput>;
	const A = ADMIN_ID;

	beforeAll(async () => {
		out = captureOutput();
		mocks = await startMocks();
		e = await startEngine({ ...mockEnv(mocks), AIOSTREAMS_USER_API_LIMIT: 'off' }, dbUrl!);
	});

	afterAll(async () => {
		await e?.close();
		await mocks?.stop();
		out?.restore();
	});

	beforeEach(async () => {
		mocks.reset();
		await e.reset();
	});

	async function pushedPerson() {
		const tpl = await e.s.createTemplate(A, {
			name: 'meta',
			kind: 'aiometadata',
			body: AIOMETADATA_TEMPLATE
		});
		const { id } = await e.s.createPerson(A, { displayName: 'Mallory' });
		await e.s.setSecret(A, 'person', id, 'tmdb_key', TMDB_KEY);
		await e.s.setBinding(A, id, 'aiometadata', {
			templateId: tpl.id,
			pinnedVersionId: null,
			overrides: {}
		});
		const { jobId } = await e.s.pushBinding(A, id, 'aiometadata');
		const [job] = await e.wait(jobId);
		expect(job.status, job.error ?? '').toBe('done');
		return id;
	}

	const liveUpstream = () => mocks.state.aiometadata.users.size;

	it('a rotate queued before a revoke does not re-create the config afterwards', async () => {
		const personId = await pushedPerson();
		expect(liveUpstream()).toBe(1);
		// rotate queued (e.g. by another tab) just before the revoke; it runs after it
		const rotateId = await e.jobs.enqueue({
			type: 'rotate',
			createdBy: A,
			personId,
			kind: 'aiometadata',
			runAfter: new Date(Date.now() + 400)
		});
		const { jobIds } = await e.s.revokePerson(A, personId);
		await e.wait([...jobIds, rotateId]);
		expect(liveUpstream()).toBe(0);
		const live = await e.db.select().from(e.t.accounts).where(eq(e.t.accounts.state, 'active'));
		expect(live).toHaveLength(0);
	});

	it('a rotate that fails after creating the new config cleans it up', async () => {
		const personId = await pushedPerson();
		expect(liveUpstream()).toBe(1);
		// every read-back of the new config fails, on every attempt
		mocks.state.aiometadata.faults.inject(
			{ status: 500 },
			{ times: 10, match: { pathPrefix: '/api/config/load' } }
		);
		const { jobId } = await e.s.rotateBinding(A, personId, 'aiometadata');
		const [job] = await e.wait(jobId);
		mocks.state.aiometadata.faults.clear();
		expect(job.status).toBe('failed');
		// only the original config is live; no half-rotated copies with the person's keys
		expect(liveUpstream()).toBe(1);
		const rotating = await e.db
			.select()
			.from(e.t.accounts)
			.where(eq(e.t.accounts.state, 'rotating'));
		expect(rotating).toHaveLength(0);
	});

	it('a rotate cleans up a half-rotated copy left by a crash', async () => {
		const personId = await pushedPerson();
		const b = await e.core.requireBinding(personId, 'aiometadata');
		// what a restart in the middle of a rotation leaves behind
		const res = await e.adapters
			.getAdapter('aiometadata')
			.create({ language: 'en-US', apiKeys: { tmdb: 'x-tmdb-key-1234' } });
		const id = crypto.randomUUID();
		await e.db.insert(e.t.accounts).values({
			id,
			bindingId: b.id,
			instanceId: b.instanceId,
			remoteUuid: res.uuid,
			...e.core.sealAccountCreds(id, { password: res.password, manifestUrl: res.manifestUrl }),
			state: 'rotating'
		});
		expect(liveUpstream()).toBe(2);
		const { jobId } = await e.s.rotateBinding(A, personId, 'aiometadata');
		const [job] = await e.wait(jobId);
		expect(job.status, job.error ?? '').toBe('done');
		expect(liveUpstream()).toBe(1);
		expect(mocks.state.aiometadata.users.has(res.uuid)).toBe(false);
	});
});
