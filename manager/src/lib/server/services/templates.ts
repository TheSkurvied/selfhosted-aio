import { and, asc, count, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { audit } from '../audit';
import { db, t } from '../db';
import type { InstanceKind } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { diffPaths } from '../sync/diff';
import { isPlainObject } from '../sync/json';
import { requiredSecrets } from '../sync/placeholders';
import { validateTemplateBody } from '../sync/validate';
import { assertKind, instanceRows, KIND_LABEL, statusesFor } from './core';
import { notFound, ServiceError } from './errors';

export { validateTemplateBody };
export { extractSecrets, applyExtraction } from '../sync/extract';

async function requireTemplate(id: string) {
	const [tpl] = await db.select().from(t.templates).where(eq(t.templates.id, id));
	if (!tpl) throw notFound('template');
	return tpl;
}

function checkBody(kind: InstanceKind, body: unknown): Record<string, unknown> {
	if (!isPlainObject(body)) throw new ServiceError('body must be a JSON object');
	const v = validateTemplateBody(kind, body);
	if (!v.ok) throw new ServiceError(`invalid ${KIND_LABEL[kind]} template: ${v.errors.join('; ')}`);
	return body;
}

export async function listTemplates(): Promise<
	Array<{
		id: string;
		name: string;
		kind: InstanceKind;
		description: string;
		currentVersion: number;
		usedBy: number;
		updatedAt: Date;
	}>
> {
	const rows = await db
		.select({ tpl: t.templates, version: t.templateVersions.version })
		.from(t.templates)
		.leftJoin(t.templateVersions, eq(t.templateVersions.id, t.templates.currentVersionId))
		.orderBy(asc(t.templates.name));
	const usage = await db
		.select({ templateId: t.personBindings.templateId, n: count() })
		.from(t.personBindings)
		.groupBy(t.personBindings.templateId);
	const used = new Map(usage.map((u) => [u.templateId, Number(u.n)]));
	return rows.map(({ tpl, version }) => ({
		id: tpl.id,
		name: tpl.name,
		kind: tpl.kind,
		description: tpl.description,
		currentVersion: version ?? 0,
		usedBy: used.get(tpl.id) ?? 0,
		updatedAt: tpl.updatedAt
	}));
}

export async function getTemplate(id: string) {
	const tpl = await requireTemplate(id);
	const versions = await db
		.select()
		.from(t.templateVersions)
		.where(eq(t.templateVersions.templateId, id))
		.orderBy(desc(t.templateVersions.version));
	const cur = versions.find((v) => v.id === tpl.currentVersionId) ?? versions[0];
	if (!cur) throw new ServiceError('template has no versions', 500);
	const bindings = await db
		.select({ b: t.personBindings, name: t.people.displayName })
		.from(t.personBindings)
		.innerJoin(t.people, eq(t.people.id, t.personBindings.personId))
		.where(eq(t.personBindings.templateId, id))
		.orderBy(asc(t.people.displayName));
	const vById = new Map(versions.map((v) => [v.id, v]));
	const usage = bindings.map(({ b, name }) => ({
		personId: b.personId,
		displayName: name,
		pinned: b.pinnedVersionId !== null,
		version: (b.pinnedVersionId ? vById.get(b.pinnedVersionId)?.version : cur.version) ?? 0
	}));
	// secret coverage for the current version's placeholders
	const names = cur.requiredSecrets;
	const personIds = [...new Set(bindings.map((x) => x.b.personId))];
	const secretRows = names.length
		? await db
				.select({ scope: t.secrets.scope, personId: t.secrets.personId, name: t.secrets.name })
				.from(t.secrets)
				.where(inArray(t.secrets.name, names))
		: [];
	const secretCoverage = names.map((name) => {
		const shared = secretRows.some((s) => s.scope === 'shared' && s.name === name);
		const withOwn = new Set(
			secretRows.filter((s) => s.scope === 'person' && s.name === name).map((s) => s.personId)
		);
		const peopleWith = personIds.filter((p) => withOwn.has(p)).length;
		return { name, shared, peopleWith, peopleNeeding: shared ? 0 : personIds.length - peopleWith };
	});
	return {
		id: tpl.id,
		name: tpl.name,
		kind: tpl.kind,
		description: tpl.description,
		versions: versions.map((v) => ({
			id: v.id,
			version: v.version,
			note: v.note,
			createdAt: v.createdAt,
			createdBy: v.createdBy
		})),
		current: {
			id: cur.id,
			version: cur.version,
			body: cur.bodyJson as object,
			requiredSecrets: cur.requiredSecrets
		},
		usage,
		secretCoverage
	};
}

export async function getTemplateVersion(templateId: string, versionId: string) {
	const [v] = await db
		.select()
		.from(t.templateVersions)
		.where(
			and(eq(t.templateVersions.id, versionId), eq(t.templateVersions.templateId, templateId))
		);
	if (!v) throw notFound('template version');
	return {
		id: v.id,
		version: v.version,
		body: v.bodyJson as object,
		requiredSecrets: v.requiredSecrets,
		note: v.note
	};
}

export async function createTemplate(
	actor: string,
	input: { name: string; kind: InstanceKind; description?: string; body: object; note?: string }
): Promise<{ id: string }> {
	const kind = assertKind(input.kind);
	const name = String(input.name ?? '').trim();
	if (!name) throw new ServiceError('name is required');
	const body = checkBody(kind, input.body);
	const [dup] = await db
		.select({ id: t.templates.id })
		.from(t.templates)
		.where(eq(t.templates.name, name));
	if (dup) throw new ServiceError(`a template named ${name} already exists`, 409);
	const id = crypto.randomUUID();
	const versionId = crypto.randomUUID();
	await db.transaction(async (tx) => {
		await tx
			.insert(t.templates)
			.values({ id, name, kind, description: String(input.description ?? '') });
		await tx.insert(t.templateVersions).values({
			id: versionId,
			templateId: id,
			version: 1,
			bodyJson: body,
			requiredSecrets: requiredSecrets(body),
			note: String(input.note ?? 'Initial version'),
			createdBy: actor
		});
		await tx.update(t.templates).set({ currentVersionId: versionId }).where(eq(t.templates.id, id));
	});
	await audit({
		actor,
		action: 'template.create',
		targetType: 'template',
		targetId: id,
		summary: `Created ${KIND_LABEL[kind]} template ${name}`
	});
	return { id };
}

export async function updateTemplateMeta(
	actor: string,
	id: string,
	patch: { name?: string; description?: string }
): Promise<void> {
	const tpl = await requireTemplate(id);
	const set: Partial<typeof t.templates.$inferInsert> = { updatedAt: new Date() };
	const changed: string[] = [];
	if (patch.name !== undefined) {
		const name = String(patch.name).trim();
		if (!name) throw new ServiceError('name cannot be empty');
		if (name !== tpl.name) {
			const [dup] = await db
				.select({ id: t.templates.id })
				.from(t.templates)
				.where(eq(t.templates.name, name));
			if (dup) throw new ServiceError(`a template named ${name} already exists`, 409);
			changed.push('name');
		}
		set.name = name;
	}
	if (patch.description !== undefined) {
		set.description = String(patch.description);
		changed.push('description');
	}
	await db.update(t.templates).set(set).where(eq(t.templates.id, id));
	await audit({
		actor,
		action: 'template.update',
		targetType: 'template',
		targetId: id,
		summary: `Updated template ${set.name ?? tpl.name}`,
		diffPaths: changed
	});
}

export async function deleteTemplate(actor: string, id: string): Promise<void> {
	const tpl = await requireTemplate(id);
	const [u] = await db
		.select({ n: count() })
		.from(t.personBindings)
		.where(eq(t.personBindings.templateId, id));
	if (Number(u?.n ?? 0) > 0)
		throw new ServiceError(`template ${tpl.name} is still used by ${u.n} binding(s)`, 409);
	await db.transaction(async (tx) => {
		await tx.update(t.templates).set({ currentVersionId: null }).where(eq(t.templates.id, id));
		// accounts may still point at these versions (rendered_from_version_id is set null on delete)
		await tx.delete(t.templates).where(eq(t.templates.id, id));
	});
	await audit({
		actor,
		action: 'template.delete',
		targetType: 'template',
		targetId: id,
		summary: `Deleted template ${tpl.name}`
	});
}

export async function saveTemplateVersion(
	actor: string,
	id: string,
	input: { body: object; note?: string }
): Promise<{ versionId: string; version: number }> {
	const tpl = await requireTemplate(id);
	const body = checkBody(tpl.kind, input.body);
	const [prev] = tpl.currentVersionId
		? await db
				.select()
				.from(t.templateVersions)
				.where(eq(t.templateVersions.id, tpl.currentVersionId))
		: [];
	const versionId = crypto.randomUUID();
	let version = 0;
	await db.transaction(async (tx) => {
		const [m] = await tx
			.select({ v: max(t.templateVersions.version) })
			.from(t.templateVersions)
			.where(eq(t.templateVersions.templateId, id));
		version = (m?.v ?? 0) + 1;
		await tx.insert(t.templateVersions).values({
			id: versionId,
			templateId: id,
			version,
			bodyJson: body,
			requiredSecrets: requiredSecrets(body),
			note: String(input.note ?? ''),
			createdBy: actor
		});
		await tx
			.update(t.templates)
			.set({ currentVersionId: versionId, updatedAt: new Date() })
			.where(eq(t.templates.id, id));
	});
	const paths = diffPaths(prev?.bodyJson ?? {}, body).map((c) => c.path);
	await audit({
		actor,
		action: 'template.version',
		targetType: 'template',
		targetId: id,
		summary: `Saved ${tpl.name} v${version}${input.note ? `: ${String(input.note).slice(0, 120)}` : ''}`,
		diffPaths: paths.slice(0, 200)
	});
	return { versionId, version };
}

/** Bindings that follow the template's latest version, with what a push would do. */
export async function dryRunTemplate(id: string): Promise<
	Array<{
		personId: string;
		displayName: string;
		kind: InstanceKind;
		willChange: boolean;
		missingSecrets: string[];
	}>
> {
	const tpl = await requireTemplate(id);
	const rows = await db
		.select({ b: t.personBindings, name: t.people.displayName })
		.from(t.personBindings)
		.innerJoin(t.people, eq(t.people.id, t.personBindings.personId))
		.where(and(eq(t.personBindings.templateId, id), isNull(t.personBindings.pinnedVersionId)))
		.orderBy(asc(t.people.displayName));
	const st = await statusesFor(rows.map((r) => r.b));
	return rows.map(({ b, name }) => {
		const s = st.get(b.id)!;
		return {
			personId: b.personId,
			displayName: name,
			kind: tpl.kind,
			willChange: !s.account?.pushedHash || s.desiredHash !== s.account.pushedHash,
			missingSecrets: s.missingSecrets
		};
	});
}

/** Queue pushes for every enabled person following the latest version. */
export async function pushTemplate(actor: string, id: string): Promise<{ jobIds: string[] }> {
	const tpl = await requireTemplate(id);
	const inst = (await instanceRows()).get(tpl.kind)!;
	const rows = await db
		.select({ personId: t.personBindings.personId })
		.from(t.personBindings)
		.innerJoin(t.people, eq(t.people.id, t.personBindings.personId))
		.where(
			and(
				eq(t.personBindings.templateId, id),
				eq(t.personBindings.instanceId, inst.id),
				isNull(t.personBindings.pinnedVersionId),
				eq(t.people.disabled, false)
			)
		);
	const jobIds: string[] = [];
	for (const r of rows)
		jobIds.push(
			await enqueue({ type: 'push', createdBy: actor, personId: r.personId, kind: tpl.kind })
		);
	await audit({
		actor,
		action: 'template.push',
		targetType: 'template',
		targetId: id,
		summary: `Queued ${jobIds.length} push(es) for template ${tpl.name}`
	});
	return { jobIds };
}
