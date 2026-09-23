/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into untyped JSON */
/**
 * Engine flows against the upstream mocks and a real Postgres.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mockEnv, startMocks, type StartedMocks } from '../mocks/index.ts';
import {
	ADMIN_EMAIL,
	ADMIN_ID,
	AIOMETADATA_TEMPLATE,
	AIOSTREAMS_RD_TEMPLATE,
	captureOutput,
	ensureTestDatabase,
	startEngine,
	type Engine
} from './helpers';

const dbUrl = await ensureTestDatabase('engine');

const RD_KEY = 'RD-SECRET-KEY-0123456789abcdef';
const RD_KEY_2 = 'RD-OTHER-KEY-9876543210fedcba';
const TMDB_KEY = 'TMDB-SHARED-KEY-deadbeef1234';

describe.skipIf(!dbUrl)('engine against mocks', () => {
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

	/** Template + person bound to both kinds, secrets set. */
	async function setupPerson(name = 'Alice', rdKey = RD_KEY) {
		const { s } = e;
		const tplS = await s.createTemplate(A, {
			name: `streams-${name}`,
			kind: 'aiostreams',
			body: AIOSTREAMS_RD_TEMPLATE
		});
		const tplM = await s.createTemplate(A, {
			name: `meta-${name}`,
			kind: 'aiometadata',
			body: AIOMETADATA_TEMPLATE
		});
		const { id } = await s.createPerson(A, { displayName: name, tags: ['family'] });
		await s.setSecret(A, 'person', id, 'rd_key', rdKey);
		await s.setSecret(A, 'shared', null, 'tmdb_key', TMDB_KEY);
		await s.setBinding(A, id, 'aiostreams', {
			templateId: tplS.id,
			pinnedVersionId: null,
			overrides: { addonName: `${name} streams` }
		});
		await s.setBinding(A, id, 'aiometadata', {
			templateId: tplM.id,
			pinnedVersionId: null,
			overrides: {}
		});
		return { personId: id, tplS: tplS.id, tplM: tplM.id };
	}

	async function pushBoth(personId: string) {
		const a = await e.s.pushBinding(A, personId, 'aiostreams');
		const b = await e.s.pushBinding(A, personId, 'aiometadata');
		const rows = await e.wait([a.jobId, b.jobId]);
		for (const r of rows) expect(r.status, r.error ?? '').toBe('done');
	}

	async function account(personId: string, kind: 'aiostreams' | 'aiometadata') {
		const b = await e.core.requireBinding(personId, kind);
		return (await e.core.activeAccount(b.id))!;
	}

	it('creates a person, binds and pushes both kinds', async () => {
		const { personId } = await setupPerson();
		let p = await e.s.getPerson(personId);
		expect(p.bindings.aiostreams?.status).toBe('never_pushed');
		expect(p.requiredSecrets).toEqual([
			{ name: 'rd_key', satisfiedBy: 'person' },
			{ name: 'tmdb_key', satisfiedBy: 'shared' }
		]);

		await pushBoth(personId);
		p = await e.s.getPerson(personId);
		expect(p.bindings.aiostreams?.status).toBe('in_sync');
		expect(p.bindings.aiometadata?.status).toBe('in_sync');
		expect(p.bindings.aiostreams?.renderedVersion).toBe(1);

		// upstream holds the resolved config
		const accS = await account(personId, 'aiostreams');
		const stored = mocks.state.aiostreams.users.get(accS.remoteUuid!)!;
		expect(stored.config.services[0].credentials.apiKey).toBe(RD_KEY);
		expect(stored.config.addonName).toBe('Alice streams');
		const accM = await account(personId, 'aiometadata');
		expect(mocks.state.aiometadata.users.get(accM.remoteUuid!)!.config.apiKeys.tmdb).toBe(TMDB_KEY);

		// manifest links use the public URLs
		expect(p.bindings.aiostreams?.manifestUrl).toMatch(
			new RegExp(`^${mocks.aiostreamsUrl}/stremio/${accS.remoteUuid}/[^/]+/manifest.json$`)
		);
		expect(p.bindings.aiometadata?.manifestUrl).toBe(
			`${mocks.aiometadataUrl}/stremio/${accM.remoteUuid}/manifest.json`
		);
		const seg = p.bindings.aiostreams!.manifestUrl!.split('/')[5];
		expect(mocks.aiostreams.decrypt(decodeURIComponent(seg))).toBeTruthy();

		// preview is masked
		const prev = await e.s.renderPreview(personId, 'aiostreams');
		expect(JSON.stringify(prev.masked)).not.toContain(RD_KEY);
		expect((prev.masked as any).services[0].credentials.apiKey).toBe('••••cdef');
		expect(prev.missingSecrets).toEqual([]);

		// list view + summary
		const list = await e.s.listPeople({ tag: 'family' });
		expect(list).toHaveLength(1);
		expect(list[0].bindings.aiostreams).toMatchObject({
			templateName: 'streams-Alice',
			version: 1,
			pinned: false,
			status: 'in_sync'
		});
		expect((await e.s.syncSummary()).in_sync).toBe(2);

		// a second push is an update, verified in sync
		await pushBoth(personId);
		expect((await e.s.getPerson(personId)).bindings.aiostreams?.status).toBe('in_sync');
		const hist = await e.s.listAudit({ personId });
		expect(hist.some((h) => h.action === 'binding.create')).toBe(true);
		expect(hist.some((h) => h.action === 'binding.push')).toBe(true);
		expect(hist[0].actorEmail).toBe(ADMIN_EMAIL);
	});

	it('detects drift after upstream edits, and adopt/overwrite resolve it', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		const accS = await account(personId, 'aiostreams');
		const accM = await account(personId, 'aiometadata');
		mocks.state.aiostreams.users.get(accS.remoteUuid!)!.config.addonName = 'Edited upstream';
		mocks.state.aiometadata.users.get(accM.remoteUuid!)!.config.language = 'de-DE';

		const { jobIds } = await e.s.checkAll(A);
		await e.wait(jobIds);
		let p = await e.s.getPerson(personId);
		expect(p.bindings.aiostreams?.status).toBe('drifted');
		expect(p.bindings.aiometadata?.status).toBe('drifted');

		const d = await e.s.diffRemote(personId, 'aiostreams');
		expect(d.changes).toEqual([{ path: 'addonName', kind: 'changed' }]);
		expect(JSON.stringify(d)).not.toContain(RD_KEY);

		// adopt AIOMetadata: remote -> overrides
		await e.s.adoptRemote(A, personId, 'aiometadata');
		p = await e.s.getPerson(personId);
		expect(p.bindings.aiometadata?.overrides).toEqual({ language: 'de-DE' });
		expect(p.bindings.aiometadata?.status).toBe('in_sync');

		// overwrite AIOStreams: push the desired config
		const { jobId } = await e.s.pushBinding(A, personId, 'aiostreams');
		await e.wait(jobId);
		expect(mocks.state.aiostreams.users.get(accS.remoteUuid!)!.config.addonName).toBe(
			'Alice streams'
		);
		expect((await e.s.getPerson(personId)).bindings.aiostreams?.status).toBe('in_sync');
	});

	it('adopt extracts new literal credentials into person secrets', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		const accS = await account(personId, 'aiostreams');
		const cfg = mocks.state.aiostreams.users.get(accS.remoteUuid!)!.config;
		cfg.services.push({
			id: 'torbox',
			enabled: true,
			credentials: { apiKey: 'TB-LITERAL-KEY-5555' }
		});
		await e.s.adoptRemote(A, personId, 'aiostreams');
		const p = await e.s.getPerson(personId);
		const ov = p.bindings.aiostreams!.overrides as any;
		expect(ov.services[1].credentials.apiKey).toBe('{{secret:torbox_api_key}}');
		expect(ov.services[0].credentials.apiKey).toBe('{{secret:rd_key}}');
		expect(p.secrets.find((x) => x.name === 'torbox_api_key')?.hint).toBe('••••5555');
		expect(p.bindings.aiostreams?.status).toBe('in_sync');
	});

	it('shows pending after a template version change, and pushTemplate clears it', async () => {
		const { personId, tplS } = await setupPerson();
		await pushBoth(personId);
		const { version } = await e.s.saveTemplateVersion(A, tplS, {
			body: { ...AIOSTREAMS_RD_TEMPLATE, formatter: { id: 'torrentio' } },
			note: 'switch formatter'
		});
		expect(version).toBe(2);
		expect((await e.s.getPerson(personId)).bindings.aiostreams?.status).toBe('pending');
		const dry = await e.s.dryRunTemplate(tplS);
		expect(dry).toEqual([
			{ personId, displayName: 'Alice', kind: 'aiostreams', willChange: true, missingSecrets: [] }
		]);
		const { jobIds } = await e.s.pushTemplate(A, tplS);
		await e.wait(jobIds);
		const p = await e.s.getPerson(personId);
		expect(p.bindings.aiostreams?.status).toBe('in_sync');
		expect(p.bindings.aiostreams?.renderedVersion).toBe(2);
		// a secret change also makes it pending
		await e.s.setSecret(A, 'person', personId, 'rd_key', RD_KEY_2);
		expect((await e.s.getPerson(personId)).bindings.aiostreams?.status).toBe('pending');
		// pinned bindings are not part of the template push
		const tpl = await e.s.getTemplate(tplS);
		await e.s.setBinding(A, personId, 'aiostreams', {
			templateId: tplS,
			pinnedVersionId: tpl.versions[1].id,
			overrides: {}
		});
		expect(await e.s.dryRunTemplate(tplS)).toEqual([]);
		expect((await e.s.getTemplate(tplS)).usage[0]).toMatchObject({ pinned: true, version: 1 });
	});

	it('marks missing after an upstream delete', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		mocks.state.aiostreams.users.delete((await account(personId, 'aiostreams')).remoteUuid!);
		mocks.state.aiometadata.users.delete((await account(personId, 'aiometadata')).remoteUuid!);
		const { jobIds } = await e.s.bulk(A, 'check', [personId]);
		await e.wait(jobIds);
		const p = await e.s.getPerson(personId);
		expect(p.bindings.aiostreams?.status).toBe('missing');
		expect(p.bindings.aiometadata?.status).toBe('missing');
		// a push refuses to silently re-create
		const { jobId } = await e.s.pushBinding(A, personId, 'aiostreams');
		const [job] = await e.wait(jobId);
		expect(job.status).toBe('failed');
		expect(job.error).toMatch(/rotate/);
		expect(job.attempts).toBe(1);
	});

	it('rotates: new config active, old deleted upstream, share page updated', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		const share = await e.s.createShareToken(A, personId, {});
		const token = share.url.split('/s/')[1];
		const before = await e.s.resolveShareToken(token);
		expect(before?.links.map((l) => l.kind)).toEqual(['aiostreams', 'aiometadata']);
		const oldS = await account(personId, 'aiostreams');
		const oldM = await account(personId, 'aiometadata');

		const r1 = await e.s.rotateBinding(A, personId, 'aiostreams');
		const r2 = await e.s.rotateBinding(A, personId, 'aiometadata');
		const rows = await e.wait([r1.jobId, r2.jobId]);
		for (const r of rows) expect(r.status, r.error ?? '').toBe('done');

		const newS = await account(personId, 'aiostreams');
		const newM = await account(personId, 'aiometadata');
		expect(newS.remoteUuid).not.toBe(oldS.remoteUuid);
		expect(mocks.state.aiostreams.users.has(oldS.remoteUuid!)).toBe(false);
		expect(mocks.state.aiometadata.users.has(oldM.remoteUuid!)).toBe(false);
		expect(
			mocks.state.aiostreams.users.get(newS.remoteUuid!)!.config.services[0].credentials.apiKey
		).toBe(RD_KEY);
		const [oldRow] = await e.db.select().from(e.t.accounts).where(eq(e.t.accounts.id, oldS.id));
		expect(oldRow.state).toBe('retired');

		const after = await e.s.resolveShareToken(token);
		expect(after!.links[0].manifestUrl).toContain(newS.remoteUuid!);
		expect(after!.links[1].manifestUrl).toContain(newM.remoteUuid!);
		expect(after!.links[0].stremioUrl).toMatch(/^stremio:\/\//);
		expect(after!.links[0].qrSvg).toMatch(/^<svg/);
		expect((await e.s.getPerson(personId)).bindings.aiostreams?.status).toBe('in_sync');
		expect(await e.s.orphanReport()).toEqual([]);
	});

	it('revokes a person: disabled, links revoked, configs deleted upstream', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		const share = await e.s.createShareToken(A, personId, {});
		const uuids = [
			(await account(personId, 'aiostreams')).remoteUuid!,
			(await account(personId, 'aiometadata')).remoteUuid!
		];
		const { jobIds } = await e.s.revokePerson(A, personId);
		expect(jobIds).toHaveLength(2);
		const rows = await e.wait(jobIds);
		for (const r of rows) expect(r.status, r.error ?? '').toBe('done');
		expect(mocks.state.aiostreams.users.has(uuids[0])).toBe(false);
		expect(mocks.state.aiometadata.users.has(uuids[1])).toBe(false);
		const p = await e.s.getPerson(personId);
		expect(p.disabled).toBe(true);
		expect(p.shareTokens[0].revokedAt).not.toBeNull();
		expect(await e.s.resolveShareToken(share.url.split('/s/')[1])).toBeNull();
		await expect(e.s.pushBinding(A, personId, 'aiostreams')).rejects.toMatchObject({ status: 409 });
	});

	it('imports an AIOStreams config by uuid + password', async () => {
		const password = 'person-own-password';
		const res = await fetch(`${mocks.aiostreamsUrl}/api/v1/user`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				password,
				config: {
					...AIOSTREAMS_RD_TEMPLATE,
					addonName: 'Bob',
					services: [{ id: 'realdebrid', enabled: true, credentials: { apiKey: RD_KEY_2 } }]
				}
			})
		});
		const uuid = ((await res.json()) as any).data.uuid as string;

		await expect(
			e.s.importAiostreams(A, { uuid, password: 'wrong-password' })
		).rejects.toMatchObject({ status: 404 });

		// against an existing template: overrides + extracted person secret
		const tpl = await e.s.createTemplate(A, {
			name: 'streams',
			kind: 'aiostreams',
			body: AIOSTREAMS_RD_TEMPLATE
		});
		const { personId } = await e.s.importAiostreams(A, {
			uuid,
			password,
			displayName: 'Bob',
			templateId: tpl.id
		});
		const p = await e.s.getPerson(personId);
		expect(p.displayName).toBe('Bob');
		expect(p.bindings.aiostreams?.status).toBe('in_sync');
		expect(p.bindings.aiostreams?.overrides).toEqual({ addonName: 'Bob' });
		expect(p.secrets).toEqual([
			expect.objectContaining({ name: 'rd_key', scope: 'person', hint: '••••dcba' })
		]);
		// a push changes nothing upstream
		const { jobId } = await e.s.pushBinding(A, personId, 'aiostreams');
		const [job] = await e.wait(jobId);
		expect(job.status, job.error ?? '').toBe('done');
		expect(job.progress).toBe('0 paths changed');
		await expect(e.s.importAiostreams(A, { uuid, password })).rejects.toMatchObject({
			status: 409
		});
	});

	it('imports an AIOMetadata config via reset-password', async () => {
		const res = await fetch(`${mocks.aiometadataUrl}/api/config/save`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				config: { language: 'fr-FR', apiKeys: { tmdb: TMDB_KEY } },
				password: 'old-pass',
				addonPassword: 'dev-addon-password'
			})
		});
		const uuid = ((await res.json()) as any).userUUID as string;
		const cands = await e.s.listAiometadataCandidates();
		expect(cands).toEqual([expect.objectContaining({ uuid, known: false })]);

		// no template: a new template is made from the config, key -> person secret
		const { personId } = await e.s.importAiometadata(A, { uuid, displayName: 'Carol' });
		const p = await e.s.getPerson(personId);
		expect(p.bindings.aiometadata?.status).toBe('in_sync');
		expect(p.bindings.aiometadata?.templateName).toMatch(/^Imported AIOMetadata/);
		expect(p.secrets.map((x) => x.name)).toEqual(['tmdb_api_key']);
		const tpl = await e.s.getTemplate(p.bindings.aiometadata!.templateId);
		expect(tpl.current.body).toEqual({
			language: 'fr-FR',
			apiKeys: { tmdb: '{{secret:tmdb_api_key}}' }
		});
		// the old password no longer works
		const old = await fetch(`${mocks.aiometadataUrl}/api/config/load/${uuid}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password: 'old-pass', addonPassword: 'dev-addon-password' })
		});
		expect(old.status).toBe(401);
		expect((await e.s.listAiometadataCandidates())[0]).toMatchObject({
			known: true,
			personName: 'Carol'
		});
		const { jobIds } = await e.s.checkAll(A);
		await e.wait(jobIds);
		expect((await e.s.getPerson(personId)).bindings.aiometadata?.status).toBe('in_sync');
	});

	it('share tokens expire, count views and honour max views', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		const limited = await e.s.createShareToken(A, personId, { maxViews: 2 });
		const tok = limited.url.split('/s/')[1];
		expect(limited.url.startsWith('http://localhost:5173/s/')).toBe(true);
		expect(await e.s.resolveShareToken(tok)).not.toBeNull();
		expect(await e.s.resolveShareToken(tok)).not.toBeNull();
		expect(await e.s.resolveShareToken(tok)).toBeNull();
		const p = await e.s.getPerson(personId);
		expect(p.shareTokens[0]).toMatchObject({ views: 2, maxViews: 2 });
		expect(JSON.stringify(p.shareTokens)).not.toContain(tok);

		const exp = await e.s.createShareToken(A, personId, { expiresInDays: 1 });
		const tok2 = exp.url.split('/s/')[1];
		expect((await e.s.resolveShareToken(tok2))?.displayName).toBe('Alice');
		await e.db
			.update(e.t.shareTokens)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(e.t.shareTokens.id, exp.id));
		expect(await e.s.resolveShareToken(tok2)).toBeNull();

		const rev = await e.s.createShareToken(A, personId, {});
		await e.s.revokeShareToken(A, rev.id);
		expect(await e.s.resolveShareToken(rev.url.split('/s/')[1])).toBeNull();
		expect(await e.s.resolveShareToken('x'.repeat(43))).toBeNull();
		// the stored value is only a hash
		const rows = await e.db.select().from(e.t.shareTokens);
		expect(JSON.stringify(rows)).not.toContain(tok);
	});

	it('bulk push keeps going when one account fails', async () => {
		const people = [];
		for (const n of ['P1', 'P2', 'P3']) people.push((await setupPerson(n)).personId);
		// P2 gets a preset whose manifest "fails" during upstream validation
		mocks.state.aiostreams.brokenPresetTypes.add('torrentio');
		const tplP2 = (await e.s.getPerson(people[1])).bindings.aiostreams!.templateId;
		await e.s.setBinding(A, people[1], 'aiostreams', {
			templateId: tplP2,
			pinnedVersionId: null,
			overrides: { presets: [{ type: 'torrentio', instanceId: 'x', enabled: true, options: {} }] }
		});
		const { jobIds } = await e.s.bulk(A, 'push', people);
		expect(jobIds).toHaveLength(6);
		const rows = await e.wait(jobIds);
		const failed = rows.filter((r) => r.status === 'failed');
		expect(failed).toHaveLength(1);
		expect(failed[0].personId).toBe(people[1]);
		expect(failed[0].kind).toBe('aiostreams');
		expect(failed[0].attempts).toBe(1); // validation errors are not retried
		expect(failed[0].error).toMatch(/USER_INVALID_CONFIG/);
		const s = await e.s.syncSummary();
		expect(s.in_sync).toBe(5);
		expect(s.error).toBe(1);
		const jl = await e.s.listJobs({ status: 'failed' });
		expect(jl[0]).toMatchObject({ personName: 'P2', kind: 'aiostreams', status: 'failed' });
	});

	it('missing secrets fail the push without retries', async () => {
		const { personId } = await setupPerson();
		await e.s.deleteSecret(A, 'person', personId, 'rd_key');
		expect((await e.s.getPerson(personId)).requiredSecrets[0]).toEqual({
			name: 'rd_key',
			satisfiedBy: null
		});
		const { jobId } = await e.s.pushBinding(A, personId, 'aiostreams');
		const [job] = await e.wait(jobId);
		expect(job.status).toBe('failed');
		expect(job.error).toBe('missing secrets: rd_key');
		const prev = await e.s.renderPreview(personId, 'aiostreams');
		expect(prev.missingSecrets).toEqual(['rd_key']);
	});

	it('removes a binding and deletes people with or without upstream deletion', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		const uS = (await account(personId, 'aiostreams')).remoteUuid!;
		const uM = (await account(personId, 'aiometadata')).remoteUuid!;
		await e.s.removeBinding(A, personId, 'aiostreams', { deleteUpstream: false });
		expect(mocks.state.aiostreams.users.has(uS)).toBe(true);
		expect(await e.s.orphanReport()).toEqual([
			expect.objectContaining({ kind: 'aiostreams', uuid: uS })
		]);
		await e.s.deletePerson(A, personId, { deleteUpstream: true });
		await e.wait((await e.s.listJobs({})).filter((j) => j.type === 'delete').map((j) => j.id));
		expect(mocks.state.aiometadata.users.has(uM)).toBe(false);
		await expect(e.s.getPerson(personId)).rejects.toMatchObject({ status: 404 });
		await expect(e.s.deleteTemplate(A, (await e.s.listTemplates())[0].id)).resolves.toBeUndefined();
	});

	it('templates: validation, secret coverage, delete protection, starters', async () => {
		await expect(
			e.s.createTemplate(A, { name: 'bad', kind: 'aiostreams', body: { presets: [] } })
		).rejects.toMatchObject({ status: 400 });
		const { personId, tplS } = await setupPerson();
		const tpl = await e.s.getTemplate(tplS);
		expect(tpl.current.requiredSecrets).toEqual(['rd_key']);
		expect(tpl.secretCoverage).toEqual([
			{ name: 'rd_key', shared: false, peopleWith: 1, peopleNeeding: 0 }
		]);
		await expect(e.s.deleteTemplate(A, tplS)).rejects.toMatchObject({ status: 409 });
		const shared = await e.s.listSharedSecrets();
		expect(shared).toEqual([
			expect.objectContaining({
				name: 'tmdb_key',
				usedByTemplates: ['meta-Alice'],
				peopleRelying: 1
			})
		]);
		expect(personId).toBeTruthy();
		const seeded = await e.s.seedStarterTemplates(A);
		expect(seeded.created).toHaveLength(3);
		expect((await e.s.seedStarterTemplates(A)).created).toEqual([]);
		const ex = e.s.extractSecrets({
			services: [{ id: 'torbox', credentials: { apiKey: 'abcdefgh' } }]
		});
		expect(ex.found[0].suggestedName).toBe('torbox_api_key');
	});

	it('health, settings and job events', async () => {
		const h = await e.s.getHealth({ fresh: true });
		expect(h.map((x) => [x.kind, x.ok])).toEqual([
			['aiostreams', true],
			['aiometadata', true]
		]);
		expect(h[0].version).toBe('2.34.1');
		const st = await e.s.getSettings();
		expect(st.instances.map((i) => i.authConfigured)).toEqual([true, true]);
		expect(st.keyFingerprint).toMatch(/^[0-9a-f]{16}$/);
		expect(st.admins.some((a) => a.email === ADMIN_EMAIL)).toBe(true);
		const { sampleHealth } = e.jobs;
		await sampleHealth();
		expect((await e.db.select().from(e.t.healthSamples)).length).toBe(4);

		const seen: string[] = [];
		const off = e.s.subscribeJobs((j) => seen.push(`${j.type}:${j.status}`));
		const { personId } = await setupPerson();
		const { jobId } = await e.s.pushBinding(A, personId, 'aiometadata');
		await e.wait(jobId);
		await new Promise((r) => setTimeout(r, 50));
		off();
		expect(seen).toContain('push:queued');
		expect(seen).toContain('push:running');
		expect(seen).toContain('push:done');
	});

	it('recovers stale running jobs at boot', async () => {
		const { personId } = await setupPerson();
		await e.jobs.stopJobRunner();
		const [row] = await e.db
			.insert(e.t.jobs)
			.values({
				type: 'push',
				personId,
				kind: 'aiometadata',
				status: 'running',
				attempts: 1,
				createdBy: A
			})
			.returning();
		await e.jobs.startJobRunner({ spacingMs: 20, backoffMs: 100, pollMs: 100 });
		const [job] = await e.wait(row.id);
		expect(job.status, job.error ?? '').toBe('done');
	});

	it('never stores or logs secret values', async () => {
		const { personId } = await setupPerson();
		await pushBoth(personId);
		// failing paths too: upstream echoes, validation errors, missing configs
		mocks.state.aiostreams.validationError = `bad key ${RD_KEY}`;
		await e.s.setBinding(A, personId, 'aiostreams', {
			templateId: (await e.s.getPerson(personId)).bindings.aiostreams!.templateId,
			pinnedVersionId: null,
			overrides: { addonName: 'changed' }
		});
		const { jobId } = await e.s.pushBinding(A, personId, 'aiostreams');
		const [job] = await e.wait(jobId);
		expect(job.status).toBe('failed');
		expect(job.error).toContain('[redacted]');
		mocks.state.aiostreams.validationError = null;
		await e.s.rotateBinding(A, personId, 'aiometadata').then((r) => e.wait(r.jobId));
		await e.s.adoptRemote(A, personId, 'aiometadata');
		await e.s.revokePerson(A, personId).then((r) => e.wait(r.jobIds));

		const accs = await e.db.select().from(e.t.accounts);
		const plain = [RD_KEY, TMDB_KEY, 'dev-admin-key', 'dev-addon-password', 'managerpass'];
		for (const a of accs) {
			const c = e.core.openAccount(a);
			if (c.password) plain.push(c.password);
			if (c.manifestSecret) plain.push(c.manifestSecret);
		}
		const dump = JSON.stringify({
			audit: await e.db.select().from(e.t.auditLog),
			jobs: await e.db.select().from(e.t.jobs),
			accounts: accs.map((a) => ({
				...a,
				passwordEnc: null,
				manifestSecretEnc: null,
				manifestUrlEnc: null
			})),
			bindings: await e.db.select().from(e.t.personBindings),
			versions: await e.db.select().from(e.t.templateVersions),
			secrets: (await e.db.select().from(e.t.secrets)).map((x) => ({ ...x, valueEnc: null })),
			person: await e.s.getPerson(personId),
			audits: await e.s.listAudit({})
		});
		const logs = out.text();
		for (const v of plain) {
			expect(dump.includes(v), `DB leaks ${v.slice(0, 4)}…`).toBe(false);
			expect(logs.includes(v), `log leaks ${v.slice(0, 4)}…`).toBe(false);
		}
	});
});
