/**
 * Opt-in: the core flow against REAL upstreams started by scripts/upstream/*.sh.
 *
 *   scripts/upstream/aiometadata.sh start
 *   RUN_REAL_UPSTREAM=1 pnpm vitest run tests/integration/real-upstream.test.ts
 *
 * AIOMetadata runs for real (http://localhost:13232, dev keys). AIOStreams
 * could not be built in the sandbox, so it stays on the mock unless
 * REAL_AIOSTREAMS_URL is set (then AIOSTREAMS_USERNAME/PASSWORD default to the
 * dev script's manager/managerpass).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockEnv, startMocks, type StartedMocks } from '../mocks/index.ts';
import {
	ADMIN_ID,
	AIOMETADATA_TEMPLATE,
	AIOSTREAMS_RD_TEMPLATE,
	ensureTestDatabase,
	startEngine,
	type Engine
} from './helpers';

const enabled = process.env.RUN_REAL_UPSTREAM === '1';
const dbUrl = enabled ? await ensureTestDatabase('real') : null;
const AMD_URL = process.env.REAL_AIOMETADATA_URL ?? 'http://localhost:13232';
const AST_URL = process.env.REAL_AIOSTREAMS_URL;
const A = ADMIN_ID;
const TMDB = 'real-test-tmdb-key-00112233';
const RD = 'real-test-rd-key-44556677';

describe.skipIf(!enabled || !dbUrl)('core flow against real upstreams', () => {
	let mocks: StartedMocks;
	let e: Engine;

	beforeAll(async () => {
		mocks = await startMocks();
		const env: Record<string, string> = {
			...mockEnv(mocks),
			AIOMETADATA_INTERNAL_URL: AMD_URL,
			AIOMETADATA_PUBLIC_URL: AMD_URL,
			AIOMETADATA_ADMIN_KEY: process.env.REAL_AIOMETADATA_ADMIN_KEY ?? 'dev-admin-key',
			AIOMETADATA_ADDON_PASSWORD:
				process.env.REAL_AIOMETADATA_ADDON_PASSWORD ?? 'dev-addon-password',
			AIOSTREAMS_USER_API_LIMIT: 'off'
		};
		if (AST_URL) {
			Object.assign(env, {
				AIOSTREAMS_INTERNAL_URL: AST_URL,
				AIOSTREAMS_PUBLIC_URL: AST_URL,
				AIOSTREAMS_USERNAME: process.env.REAL_AIOSTREAMS_USERNAME ?? 'manager',
				AIOSTREAMS_PASSWORD: process.env.REAL_AIOSTREAMS_PASSWORD ?? 'managerpass'
			});
		}
		e = await startEngine(env, dbUrl!);
	});

	afterAll(async () => {
		await e?.close();
		await mocks?.stop();
	});

	const amd = (path: string, init: RequestInit = {}) =>
		fetch(`${AMD_URL}${path}`, {
			...init,
			headers: {
				'content-type': 'application/json',
				'x-admin-key': 'dev-admin-key',
				...(init.headers ?? {})
			}
		});

	it('health', async () => {
		const h = await e.s.getHealth({ fresh: true });
		const m = h.find((x) => x.kind === 'aiometadata')!;
		expect(m.ok, JSON.stringify(m.checks)).toBe(true);
		expect(m.version).toBeTruthy();
	});

	it('push, check, drift, adopt, rotate, import, revoke', async () => {
		const tplM = await e.s.createTemplate(A, {
			name: 'real-meta',
			kind: 'aiometadata',
			body: AIOMETADATA_TEMPLATE
		});
		const tplS = await e.s.createTemplate(A, {
			name: 'real-streams',
			kind: 'aiostreams',
			body: AIOSTREAMS_RD_TEMPLATE
		});
		const { id } = await e.s.createPerson(A, { displayName: 'Real Person' });
		await e.s.setSecret(A, 'shared', null, 'tmdb_key', TMDB);
		await e.s.setSecret(A, 'person', id, 'rd_key', RD);
		await e.s.setBinding(A, id, 'aiometadata', {
			templateId: tplM.id,
			pinnedVersionId: null,
			overrides: { language: 'en-GB' }
		});
		await e.s.setBinding(A, id, 'aiostreams', {
			templateId: tplS.id,
			pinnedVersionId: null,
			overrides: {}
		});

		// push both
		const pushed = await e.wait([
			(await e.s.pushBinding(A, id, 'aiometadata')).jobId,
			(await e.s.pushBinding(A, id, 'aiostreams')).jobId
		]);
		for (const j of pushed) expect(j.status, j.error ?? '').toBe('done');
		let p = await e.s.getPerson(id);
		expect(p.bindings.aiometadata?.status).toBe('in_sync');
		expect(p.bindings.aiostreams?.status).toBe('in_sync');
		const manifest = await fetch(p.bindings.aiometadata!.manifestUrl!);
		expect(manifest.status).toBe(200);

		// check: still in sync (upstream normalisation is ignored)
		await e.wait((await e.s.checkAll(A)).jobIds);
		p = await e.s.getPerson(id);
		expect(p.bindings.aiometadata?.status).toBe('in_sync');

		// drift: edit the config upstream with its own password
		const acc = (await e.core.activeAccount(p.bindings.aiometadata!.id))!;
		const creds = e.core.openAccount(acc);
		const upd = await amd(`/api/config/update/${acc.remoteUuid}`, {
			method: 'PUT',
			body: JSON.stringify({
				config: { language: 'es-ES', apiKeys: { tmdb: TMDB } },
				password: creds.password,
				addonPassword: 'dev-addon-password'
			})
		});
		expect(upd.status).toBe(200);
		await e.wait((await e.s.checkBinding(A, id, 'aiometadata')).jobId);
		expect((await e.s.getPerson(id)).bindings.aiometadata?.status).toBe('drifted');
		const d = await e.s.diffRemote(id, 'aiometadata');
		expect(d.changes).toEqual([{ path: 'language', kind: 'changed' }]);
		expect(JSON.stringify(d)).not.toContain(TMDB);

		// adopt
		await e.s.adoptRemote(A, id, 'aiometadata');
		p = await e.s.getPerson(id);
		expect(p.bindings.aiometadata?.overrides).toEqual({ language: 'es-ES' });
		expect(p.bindings.aiometadata?.status).toBe('in_sync');
		await e.wait((await e.s.checkBinding(A, id, 'aiometadata')).jobId);
		expect((await e.s.getPerson(id)).bindings.aiometadata?.status).toBe('in_sync');

		// rotate: old config deleted upstream
		const [rot] = await e.wait((await e.s.rotateBinding(A, id, 'aiometadata')).jobId);
		expect(rot.status, rot.error ?? '').toBe('done');
		expect((await amd(`/api/admin/users/${acc.remoteUuid}`)).status).toBe(404);
		p = await e.s.getPerson(id);
		expect(p.bindings.aiometadata?.account?.remoteUuid).not.toBe(acc.remoteUuid);
		expect(p.bindings.aiometadata?.status).toBe('in_sync');

		// missing: delete upstream behind our back
		const cur = p.bindings.aiometadata!.account!.remoteUuid!;
		expect((await amd(`/api/admin/users/${cur}`, { method: 'DELETE' })).status).toBe(200);
		await e.wait((await e.s.checkBinding(A, id, 'aiometadata')).jobId);
		expect((await e.s.getPerson(id)).bindings.aiometadata?.status).toBe('missing');
		const [rot2] = await e.wait((await e.s.rotateBinding(A, id, 'aiometadata')).jobId);
		expect(rot2.status, rot2.error ?? '').toBe('done');
		expect((await e.s.getPerson(id)).bindings.aiometadata?.status).toBe('in_sync');

		// import a config someone else made
		const saved = await amd('/api/config/save', {
			method: 'POST',
			body: JSON.stringify({
				config: { language: 'it-IT', apiKeys: { tmdb: TMDB } },
				password: 'their-pass',
				addonPassword: 'dev-addon-password'
			})
		});
		const uuid = ((await saved.json()) as { userUUID: string }).userUUID;
		const cands = await e.s.listAiometadataCandidates();
		expect(cands.find((c) => c.uuid === uuid)?.known).toBe(false);
		const imp = await e.s.importAiometadata(A, {
			uuid,
			displayName: 'Imported Real',
			templateId: tplM.id
		});
		const ip = await e.s.getPerson(imp.personId);
		expect(ip.bindings.aiometadata?.status).toBe('in_sync');
		expect(ip.bindings.aiometadata?.overrides).toEqual({ language: 'it-IT' });
		expect(ip.requiredSecrets).toEqual([{ name: 'tmdb_key', satisfiedBy: 'shared' }]);
		const oldLoad = await amd(`/api/config/load/${uuid}`, {
			method: 'POST',
			body: JSON.stringify({ password: 'their-pass', addonPassword: 'dev-addon-password' })
		});
		expect(oldLoad.status).toBe(401);

		// revoke both people: upstream configs deleted
		const live = [(await e.s.getPerson(id)).bindings.aiometadata!.account!.remoteUuid!, uuid];
		const jobs = [
			...(await e.s.revokePerson(A, id)).jobIds,
			...(await e.s.revokePerson(A, imp.personId)).jobIds
		];
		for (const j of await e.wait(jobs)) expect(j.status, j.error ?? '').toBe('done');
		for (const u of live) expect((await amd(`/api/admin/users/${u}`)).status).toBe(404);

		// nothing sensitive stored in plaintext
		const dump = JSON.stringify({
			audit: await e.db.select().from(e.t.auditLog),
			jobs: await e.db.select().from(e.t.jobs)
		});
		for (const v of [TMDB, RD, 'their-pass', creds.password!]) expect(dump.includes(v)).toBe(false);
	}, 120_000);
});
