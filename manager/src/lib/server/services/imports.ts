/**
 * Imports (spec section 8):
 *  - AIOStreams: the admin supplies uuid + password (configs are encrypted with it).
 *  - AIOMetadata: pick from the admin list; the manager sets a new password via
 *    reset-password (the person's old password stops working).
 * The imported config becomes a binding: against the given template (overrides
 * = merge patch from the template body), or against a new template made from
 * the config itself. Literal credentials become person secrets.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { aiometadata, aiostreams, getAdapter, UpstreamError } from '../adapters';
import { sanitize } from '../adapters/http';
import { audit } from '../audit';
import { randomToken } from '../crypto';
import { db, t } from '../db';
import type { InstanceKind } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { log } from '../log';
import { extractSecrets } from '../sync/extract';
import { requiredSecrets } from '../sync/placeholders';
import { configHash } from '../sync/hash';
import { render } from '../sync/render';
import { strip } from '../sync/strip';
import { validateTemplateBody } from '../sync/validate';
import { remoteToOverrides } from './actions';
import {
	activeAccount,
	effectiveVersion,
	instanceRows,
	KIND_LABEL,
	sealAccountCreds,
	secretLookup,
	secretRows,
	upsertSecret
} from './core';
import { notFound, ServiceError } from './errors';
import { createPerson } from './people';

function upstreamFailure(e: unknown, scrub: string[] = []): ServiceError {
	const msg = sanitize(e instanceof Error ? e.message : String(e), scrub);
	if (e instanceof UpstreamError && e.isMissing)
		return new ServiceError(`${msg} (check the uuid and password)`, 404);
	return new ServiceError(msg, 502);
}

async function uniqueTemplateName(base: string): Promise<string> {
	for (let i = 1; ; i++) {
		const name = i === 1 ? base : `${base} (${i})`;
		const [dup] = await db
			.select({ id: t.templates.id })
			.from(t.templates)
			.where(eq(t.templates.name, name));
		if (!dup) return name;
	}
}

type ImportInput = {
	kind: InstanceKind;
	uuid: string;
	password: string;
	remote: Record<string, unknown>;
	manifestUrl: string;
	manifestSecret?: string | null;
	personId?: string;
	displayName?: string;
	templateId?: string;
};

async function finishImport(actor: string, x: ImportInput): Promise<{ personId: string }> {
	const insts = await instanceRows();
	const inst = insts.get(x.kind)!;
	// the same upstream config must not be managed twice
	const [known] = await db
		.select({ id: t.accounts.id })
		.from(t.accounts)
		.where(
			and(
				eq(t.accounts.instanceId, inst.id),
				eq(t.accounts.remoteUuid, x.uuid),
				inArray(t.accounts.state, ['active', 'rotating'])
			)
		);
	if (known) throw new ServiceError('this config is already managed by AIO Manager', 409);

	let personId = x.personId;
	let createdPerson = false;
	if (personId) {
		const [p] = await db.select().from(t.people).where(eq(t.people.id, personId));
		if (!p) throw notFound('person');
		const [b] = await db
			.select()
			.from(t.personBindings)
			.where(
				and(eq(t.personBindings.personId, personId), eq(t.personBindings.instanceId, inst.id))
			);
		if (b && (await activeAccount(b.id))?.remoteUuid) {
			throw new ServiceError(
				`${p.displayName} already has a managed ${KIND_LABEL[x.kind]} config`,
				409
			);
		}
	} else {
		const name = (x.displayName ?? '').trim() || `Imported ${x.uuid.slice(0, 8)}`;
		personId = (await createPerson(actor, { displayName: name })).id;
		createdPerson = true;
	}

	try {
		let templateId = x.templateId;
		let overrides: Record<string, unknown> = {};
		let createdSecrets: string[] = [];
		if (templateId) {
			const [tpl] = await db.select().from(t.templates).where(eq(t.templates.id, templateId));
			if (!tpl) throw notFound('template');
			if (tpl.kind !== x.kind)
				throw new ServiceError(`template ${tpl.name} is not an ${KIND_LABEL[x.kind]} template`);
			const v = await effectiveVersion({ templateId, pinnedVersionId: null });
			({ overrides, createdSecrets } = await remoteToOverrides(
				x.kind,
				personId,
				x.remote,
				v.bodyJson
			));
		} else {
			// new template from the config itself, secrets extracted into person secrets
			const stripped = strip(x.kind, x.remote);
			const ex = extractSecrets(stripped);
			const seen = new Set<string>();
			for (const f of ex.found) {
				if (seen.has(f.suggestedName)) continue;
				seen.add(f.suggestedName);
				await upsertSecret('person', personId, f.suggestedName, f.value);
				createdSecrets.push(f.suggestedName);
			}
			const body = ex.body as Record<string, unknown>;
			const valid = validateTemplateBody(x.kind, body);
			if (!valid.ok)
				log.warn('imported config does not pass template validation', { errors: valid.errors });
			const name = await uniqueTemplateName(`Imported ${KIND_LABEL[x.kind]} ${x.uuid.slice(0, 8)}`);
			const tplId = crypto.randomUUID();
			const vId = crypto.randomUUID();
			await db.transaction(async (tx) => {
				await tx
					.insert(t.templates)
					.values({ id: tplId, name, kind: x.kind, description: `Created by import of ${x.uuid}` });
				await tx.insert(t.templateVersions).values({
					id: vId,
					templateId: tplId,
					version: 1,
					bodyJson: body,
					requiredSecrets: requiredSecrets(body),
					note: 'Imported',
					createdBy: actor
				});
				await tx
					.update(t.templates)
					.set({ currentVersionId: vId })
					.where(eq(t.templates.id, tplId));
			});
			templateId = tplId;
		}

		// binding (replace an existing unpushed one)
		const [existing] = await db
			.select()
			.from(t.personBindings)
			.where(
				and(eq(t.personBindings.personId, personId), eq(t.personBindings.instanceId, inst.id))
			);
		let bindingId: string;
		if (existing) {
			bindingId = existing.id;
			await db
				.delete(t.accounts)
				.where(and(eq(t.accounts.bindingId, existing.id), eq(t.accounts.state, 'active')));
			await db
				.update(t.personBindings)
				.set({ templateId, pinnedVersionId: null, overridesJson: overrides, updatedAt: new Date() })
				.where(eq(t.personBindings.id, existing.id));
		} else {
			bindingId = crypto.randomUUID();
			await db.insert(t.personBindings).values({
				id: bindingId,
				personId,
				instanceId: inst.id,
				templateId,
				overridesJson: overrides
			});
		}
		const version = await effectiveVersion({ templateId, pinnedVersionId: null });
		const r = render({
			kind: x.kind,
			base: version.bodyJson,
			overrides,
			lookup: secretLookup(await secretRows(personId)).lookup
		});
		const accId = crypto.randomUUID();
		await db.insert(t.accounts).values({
			id: accId,
			bindingId,
			instanceId: inst.id,
			remoteUuid: x.uuid,
			...sealAccountCreds(accId, {
				password: x.password,
				manifestSecret: x.manifestSecret ?? null,
				manifestUrl: x.manifestUrl
			}),
			state: 'active',
			desiredHash: r.desiredHash,
			pushedHash: r.desiredHash,
			remoteHash: configHash(x.kind, x.remote),
			renderedFromVersionId: version.id,
			lastCheckAt: new Date(),
			checkStatus: 'ok'
		});
		await audit({
			actor,
			action: 'import',
			targetType: 'person',
			targetId: personId,
			summary: `Imported ${KIND_LABEL[x.kind]} config ${x.uuid}${createdSecrets.length ? `; person secrets: ${createdSecrets.join(', ')}` : ''}`
		});
		// record the import in the job list; the queued job re-checks the account
		await enqueue({
			type: 'import',
			createdBy: actor,
			personId,
			kind: x.kind,
			payload: { uuid: x.uuid }
		});
		return { personId };
	} catch (e) {
		if (createdPerson) await db.delete(t.people).where(eq(t.people.id, personId));
		throw e;
	}
}

export async function importAiostreams(
	actor: string,
	input: {
		uuid: string;
		password: string;
		personId?: string;
		displayName?: string;
		templateId?: string;
	}
): Promise<{ personId: string }> {
	const uuid = String(input.uuid ?? '').trim();
	const password = String(input.password ?? '');
	if (!/^[0-9a-zA-Z-]{8,64}$/.test(uuid)) throw new ServiceError('uuid looks invalid');
	if (!password) throw new ServiceError('password is required');
	const a = aiostreams();
	let exists: boolean;
	try {
		exists = await a.exists(uuid);
	} catch (e) {
		throw upstreamFailure(e, [password]);
	}
	if (!exists) throw new ServiceError('no AIOStreams config with that uuid', 404);
	let got;
	try {
		got = await a.readWithSecret(uuid, password);
	} catch (e) {
		throw upstreamFailure(e, [password]);
	}
	const manifestSecret = got.encryptedPassword ?? null;
	if (!manifestSecret) throw new ServiceError('AIOStreams did not return a manifest segment', 502);
	return finishImport(actor, {
		kind: 'aiostreams',
		uuid,
		password,
		remote: got.config,
		manifestSecret,
		manifestUrl: a.manifestUrl(uuid, manifestSecret),
		personId: input.personId,
		displayName: input.displayName,
		templateId: input.templateId
	});
}

export async function listAiometadataCandidates(): Promise<
	Array<{
		uuid: string;
		createdAt: string;
		lastUpdated: string;
		known: boolean;
		personName?: string;
	}>
> {
	let users;
	try {
		users = await aiometadata().adminList();
	} catch (e) {
		throw upstreamFailure(e);
	}
	const inst = (await instanceRows()).get('aiometadata')!;
	const rows = await db
		.select({ uuid: t.accounts.remoteUuid, name: t.people.displayName })
		.from(t.accounts)
		.leftJoin(t.personBindings, eq(t.personBindings.id, t.accounts.bindingId))
		.leftJoin(t.people, eq(t.people.id, t.personBindings.personId))
		.where(
			and(eq(t.accounts.instanceId, inst.id), inArray(t.accounts.state, ['active', 'rotating']))
		);
	const known = new Map(rows.map((r) => [r.uuid, r.name]));
	return users.map((u) => ({
		uuid: u.uuid,
		createdAt: String(u.created_at ?? ''),
		lastUpdated: String(u.last_updated ?? ''),
		known: known.has(u.uuid),
		personName: known.get(u.uuid) ?? undefined
	}));
}

export async function importAiometadata(
	actor: string,
	input: { uuid: string; personId?: string; displayName?: string; templateId?: string }
): Promise<{ personId: string }> {
	const uuid = String(input.uuid ?? '').trim();
	if (!uuid) throw new ServiceError('uuid is required');
	const a = aiometadata();
	try {
		await a.adminDetail(uuid);
	} catch (e) {
		if (e instanceof UpstreamError && e.code === 'not_found')
			throw new ServiceError('no AIOMetadata config with that uuid', 404);
		throw upstreamFailure(e);
	}
	const inst = (await instanceRows()).get('aiometadata')!;
	const [known] = await db
		.select({ id: t.accounts.id })
		.from(t.accounts)
		.where(
			and(
				eq(t.accounts.instanceId, inst.id),
				eq(t.accounts.remoteUuid, uuid),
				inArray(t.accounts.state, ['active', 'rotating'])
			)
		);
	if (known) throw new ServiceError('this config is already managed by AIO Manager', 409);
	const password = randomToken(32);
	let remote;
	try {
		await a.resetPassword(uuid, password);
		remote = await a.read(uuid, password);
	} catch (e) {
		throw upstreamFailure(e, [password]);
	}
	return finishImport(actor, {
		kind: 'aiometadata',
		uuid,
		password,
		remote,
		manifestUrl: a.manifestUrl(uuid),
		personId: input.personId,
		displayName: input.displayName,
		templateId: input.templateId
	});
}

/** Upstream configs the manager does not manage (AIOStreams needs an admin login). */
export async function orphanReport(): Promise<
	Array<{ kind: InstanceKind; uuid: string; createdAt?: string }>
> {
	const insts = await instanceRows();
	const out: Array<{ kind: InstanceKind; uuid: string; createdAt?: string }> = [];
	for (const kind of ['aiostreams', 'aiometadata'] as const) {
		const inst = insts.get(kind)!;
		let remote;
		try {
			remote = await getAdapter(kind).listRemote();
		} catch (e) {
			log.warn('orphan report: listing failed', { kind, error: (e as Error).message });
			continue;
		}
		const rows = await db
			.select({ uuid: t.accounts.remoteUuid })
			.from(t.accounts)
			.where(
				and(eq(t.accounts.instanceId, inst.id), inArray(t.accounts.state, ['active', 'rotating']))
			);
		const managed = new Set(rows.map((r) => r.uuid));
		for (const u of remote)
			if (!managed.has(u.uuid)) out.push({ kind, uuid: u.uuid, createdAt: u.createdAt });
	}
	return out;
}
