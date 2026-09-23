import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { getAdapter, UpstreamError } from '../adapters';
import { audit } from '../audit';
import { db, t } from '../db';
import type { InstanceKind, PersonBinding } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { diffPaths } from '../sync/diff';
import { isPlainObject } from '../sync/json';
import { maskConfig } from '../sync/mask';
import { applyMergePatch } from '../sync/merge-patch';
import { requiredSecrets as namesIn } from '../sync/placeholders';
import { strip } from '../sync/strip';
import { sanitize } from '../adapters/http';
import { listAudit } from './audit-list';
import {
	activeAccount,
	assertKind,
	instanceRows,
	KIND_LABEL,
	KINDS,
	openAccount,
	renderBinding,
	requireBinding,
	secretRows,
	statusesFor
} from './core';
import { notFound, ServiceError } from './errors';
import type { BindingDetail, BindingSummary, PersonDetail, PersonRow } from './types';

function cleanTags(tags: unknown): string[] {
	if (!Array.isArray(tags)) return [];
	return [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))].slice(0, 50);
}

async function requirePerson(id: string) {
	const [p] = await db.select().from(t.people).where(eq(t.people.id, id));
	if (!p) throw notFound('person');
	return p;
}

/** Binding summaries for many people, keyed by personId. */
async function summaries(personIds: string[]): Promise<Map<string, Record<InstanceKind, BindingSummary | null>>> {
	const out = new Map<string, Record<InstanceKind, BindingSummary | null>>();
	for (const id of personIds) out.set(id, { aiostreams: null, aiometadata: null });
	if (personIds.length === 0) return out;
	const bindings = await db.select().from(t.personBindings).where(inArray(t.personBindings.personId, personIds));
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const tpls = bindings.length
		? await db
				.select({ id: t.templates.id, name: t.templates.name })
				.from(t.templates)
				.where(inArray(t.templates.id, [...new Set(bindings.map((b) => b.templateId))]))
		: [];
	const tplName = new Map(tpls.map((x) => [x.id, x.name]));
	const st = await statusesFor(bindings);
	for (const b of bindings) {
		const kind = kindById.get(b.instanceId);
		if (!kind) continue;
		const s = st.get(b.id)!;
		out.get(b.personId)![kind] = {
			templateName: tplName.get(b.templateId) ?? '',
			version: s.version?.version ?? 0,
			pinned: b.pinnedVersionId !== null,
			status: s.status
		};
	}
	return out;
}

export async function listPeople(q: { search?: string; tag?: string } = {}): Promise<PersonRow[]> {
	const conds = [];
	if (q.search?.trim()) conds.push(ilike(t.people.displayName, `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`));
	if (q.tag?.trim()) conds.push(sql`${q.tag.trim()} = any(${t.people.tags})`);
	const people = await db
		.select()
		.from(t.people)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(asc(t.people.displayName));
	const s = await summaries(people.map((p) => p.id));
	return people.map((p) => ({
		id: p.id,
		displayName: p.displayName,
		tags: p.tags,
		disabled: p.disabled,
		notes: p.notes,
		bindings: s.get(p.id)!
	}));
}

export async function getPerson(id: string): Promise<PersonDetail> {
	const p = await requirePerson(id);
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const bindings = await db.select().from(t.personBindings).where(eq(t.personBindings.personId, id));
	const st = await statusesFor(bindings);
	const detail: Record<InstanceKind, BindingDetail | null> = { aiostreams: null, aiometadata: null };
	const needed = new Set<string>();
	for (const b of bindings) {
		const kind = kindById.get(b.instanceId);
		if (!kind) continue;
		const s = st.get(b.id)!;
		const [tpl] = await db.select().from(t.templates).where(eq(t.templates.id, b.templateId));
		const [cur] = tpl?.currentVersionId
			? await db.select().from(t.templateVersions).where(eq(t.templateVersions.id, tpl.currentVersionId))
			: [];
		let renderedVersion: number | null = null;
		if (s.account?.renderedFromVersionId) {
			const [rv] = await db
				.select({ v: t.templateVersions.version })
				.from(t.templateVersions)
				.where(eq(t.templateVersions.id, s.account.renderedFromVersionId));
			renderedVersion = rv?.v ?? null;
		}
		let manifestUrl: string | undefined;
		if (s.account?.remoteUuid) {
			try {
				manifestUrl = openAccount(s.account).manifestUrl ?? undefined;
			} catch {
				manifestUrl = undefined;
			}
		}
		if (s.version) {
			for (const n of namesIn(applyMergePatch(s.version.bodyJson, b.overridesJson ?? {}))) needed.add(n);
		}
		detail[kind] = {
			id: b.id,
			templateId: b.templateId,
			templateName: tpl?.name ?? '',
			pinnedVersionId: b.pinnedVersionId,
			currentVersion: cur?.version ?? 0,
			renderedVersion,
			overrides: b.overridesJson ?? {},
			status: s.status,
			lastError: s.account?.lastError ?? undefined,
			account: s.account
				? {
						id: s.account.id,
						remoteUuid: s.account.remoteUuid,
						state: s.account.state,
						lastPushAt: s.account.lastPushAt,
						lastCheckAt: s.account.lastCheckAt,
						createdAt: s.account.createdAt
					}
				: undefined,
			manifestUrl,
			missingSecrets: s.missingSecrets,
			effectiveVersion: s.version?.version
		};
	}
	const sec = await secretRows(id);
	const secrets = [
		...[...sec.person.values()].map((s) => ({ name: s.name, scope: 'person' as const, hint: s.hint, updatedAt: s.updatedAt })),
		...[...sec.shared.values()]
			.filter((s) => needed.has(s.name))
			.map((s) => ({ name: s.name, scope: 'shared' as const, hint: s.hint, updatedAt: s.updatedAt }))
	].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
	const requiredSecrets = [...needed].sort().map((name) => ({
		name,
		satisfiedBy: sec.person.has(name) ? ('person' as const) : sec.shared.has(name) ? ('shared' as const) : null
	}));
	const tokens = await db
		.select()
		.from(t.shareTokens)
		.where(eq(t.shareTokens.personId, id))
		.orderBy(desc(t.shareTokens.createdAt));
	return {
		id: p.id,
		displayName: p.displayName,
		tags: p.tags,
		disabled: p.disabled,
		notes: p.notes,
		createdAt: p.createdAt,
		bindings: detail,
		secrets,
		requiredSecrets,
		shareTokens: tokens.map((x) => ({
			id: x.id,
			createdAt: x.createdAt,
			expiresAt: x.expiresAt,
			maxViews: x.maxViews,
			views: x.views,
			revokedAt: x.revokedAt
		})),
		history: await listAudit({ personId: id, limit: 50 })
	};
}

export async function createPerson(
	actor: string,
	input: { displayName: string; notes?: string; tags?: string[] }
): Promise<{ id: string }> {
	const displayName = String(input.displayName ?? '').trim();
	if (!displayName) throw new ServiceError('displayName is required');
	if (displayName.length > 200) throw new ServiceError('displayName is too long');
	const id = crypto.randomUUID();
	await db.insert(t.people).values({
		id,
		displayName,
		notes: String(input.notes ?? ''),
		tags: cleanTags(input.tags)
	});
	await audit({ actor, action: 'person.create', targetType: 'person', targetId: id, summary: `Created person ${displayName}` });
	return { id };
}

export async function updatePerson(
	actor: string,
	id: string,
	patch: { displayName?: string; notes?: string; tags?: string[]; disabled?: boolean }
): Promise<void> {
	const p = await requirePerson(id);
	const set: Partial<typeof t.people.$inferInsert> = { updatedAt: new Date() };
	const changed: string[] = [];
	if (patch.displayName !== undefined) {
		const n = String(patch.displayName).trim();
		if (!n) throw new ServiceError('displayName cannot be empty');
		if (n !== p.displayName) changed.push('displayName');
		set.displayName = n;
	}
	if (patch.notes !== undefined) {
		if (patch.notes !== p.notes) changed.push('notes');
		set.notes = String(patch.notes);
	}
	if (patch.tags !== undefined) {
		set.tags = cleanTags(patch.tags);
		changed.push('tags');
	}
	if (patch.disabled !== undefined) {
		if (patch.disabled !== p.disabled) changed.push('disabled');
		set.disabled = !!patch.disabled;
	}
	await db.update(t.people).set(set).where(eq(t.people.id, id));
	await audit({
		actor,
		action: 'person.update',
		targetType: 'person',
		targetId: id,
		summary: `Updated ${set.displayName ?? p.displayName}${changed.length ? ` (${changed.join(', ')})` : ''}`,
		diffPaths: changed
	});
}

/** Retire every live account of a binding; optionally queue upstream deletion. Returns job ids. */
async function retireBindingAccounts(
	actor: string,
	b: PersonBinding,
	deleteUpstream: boolean,
	kind: InstanceKind
): Promise<string[]> {
	const accs = await db
		.select()
		.from(t.accounts)
		.where(and(eq(t.accounts.bindingId, b.id), inArray(t.accounts.state, ['active', 'rotating', 'error'])));
	const jobIds: string[] = [];
	for (const a of accs) {
		await db.update(t.accounts).set({ state: 'retired', retiredAt: new Date() }).where(eq(t.accounts.id, a.id));
		if (deleteUpstream && a.remoteUuid) {
			jobIds.push(
				await enqueue({ type: 'delete', createdBy: actor, personId: b.personId, kind, accountId: a.id, payload: { accountId: a.id } })
			);
		}
	}
	return jobIds;
}

export async function deletePerson(actor: string, id: string, opts: { deleteUpstream: boolean }): Promise<void> {
	const p = await requirePerson(id);
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const bindings = await db.select().from(t.personBindings).where(eq(t.personBindings.personId, id));
	for (const b of bindings) {
		await retireBindingAccounts(actor, b, !!opts.deleteUpstream, kindById.get(b.instanceId) ?? 'aiostreams');
	}
	// Retired accounts keep their row (binding_id goes null) so the orphan
	// report and the queued delete jobs still find them.
	await db.delete(t.people).where(eq(t.people.id, id));
	await audit({
		actor,
		action: 'person.delete',
		targetType: 'person',
		targetId: id,
		summary: `Deleted person ${p.displayName}${opts.deleteUpstream ? ' and queued upstream deletion' : ' (upstream configs kept)'}`
	});
}

export async function setBinding(
	actor: string,
	personId: string,
	kindIn: InstanceKind,
	input: { templateId: string; pinnedVersionId: string | null; overrides: object }
): Promise<void> {
	const kind = assertKind(kindIn);
	const p = await requirePerson(personId);
	const [tpl] = await db.select().from(t.templates).where(eq(t.templates.id, input.templateId));
	if (!tpl) throw notFound('template');
	if (tpl.kind !== kind) throw new ServiceError(`template ${tpl.name} is for ${KIND_LABEL[tpl.kind]}, not ${KIND_LABEL[kind]}`);
	if (input.pinnedVersionId) {
		const [v] = await db
			.select()
			.from(t.templateVersions)
			.where(and(eq(t.templateVersions.id, input.pinnedVersionId), eq(t.templateVersions.templateId, tpl.id)));
		if (!v) throw new ServiceError('pinned version does not belong to this template');
	}
	const overrides = input.overrides ?? {};
	if (!isPlainObject(overrides)) throw new ServiceError('overrides must be a JSON object');
	const inst = (await instanceRows()).get(kind)!;
	const [existing] = await db
		.select()
		.from(t.personBindings)
		.where(and(eq(t.personBindings.personId, personId), eq(t.personBindings.instanceId, inst.id)));
	const paths = diffPaths(existing?.overridesJson ?? {}, overrides).map((c) => `overrides.${c.path}`);
	if (existing) {
		if (existing.templateId !== tpl.id) paths.unshift('templateId');
		if (existing.pinnedVersionId !== (input.pinnedVersionId ?? null)) paths.unshift('pinnedVersionId');
		await db
			.update(t.personBindings)
			.set({
				templateId: tpl.id,
				pinnedVersionId: input.pinnedVersionId ?? null,
				overridesJson: overrides,
				updatedAt: new Date()
			})
			.where(eq(t.personBindings.id, existing.id));
	} else {
		await db.insert(t.personBindings).values({
			personId,
			instanceId: inst.id,
			templateId: tpl.id,
			pinnedVersionId: input.pinnedVersionId ?? null,
			overridesJson: overrides
		});
	}
	await audit({
		actor,
		action: existing ? 'binding.update' : 'binding.set',
		targetType: 'person',
		targetId: personId,
		summary: `${existing ? 'Updated' : 'Bound'} ${KIND_LABEL[kind]} for ${p.displayName} to template ${tpl.name}${input.pinnedVersionId ? ' (pinned)' : ''}`,
		diffPaths: paths
	});
}

export async function removeBinding(
	actor: string,
	personId: string,
	kindIn: InstanceKind,
	opts: { deleteUpstream: boolean }
): Promise<void> {
	const kind = assertKind(kindIn);
	const p = await requirePerson(personId);
	const b = await requireBinding(personId, kind);
	await retireBindingAccounts(actor, b, !!opts.deleteUpstream, kind);
	await db.delete(t.personBindings).where(eq(t.personBindings.id, b.id));
	await audit({
		actor,
		action: 'binding.remove',
		targetType: 'person',
		targetId: personId,
		summary: `Removed ${KIND_LABEL[kind]} binding for ${p.displayName}${opts.deleteUpstream ? ' and queued upstream deletion' : ' (upstream config kept)'}`
	});
}

export async function renderPreview(
	personId: string,
	kindIn: InstanceKind
): Promise<{ masked: object; desiredHash: string; missingSecrets: string[]; errors?: string[] }> {
	const kind = assertKind(kindIn);
	const b = await requireBinding(personId, kind);
	const r = await renderBinding(b, kind);
	return {
		masked: maskConfig(r.resolved, r.secretValues()) as object,
		desiredHash: r.desiredHash,
		missingSecrets: r.missingSecrets,
		errors: r.errors
	};
}

export async function diffRemote(
	personId: string,
	kindIn: InstanceKind
): Promise<{ changes: Array<{ path: string; kind: 'added' | 'removed' | 'changed' }>; maskedRemote: object; maskedDesired: object }> {
	const kind = assertKind(kindIn);
	const b = await requireBinding(personId, kind);
	const acc = await activeAccount(b.id);
	if (!acc?.remoteUuid) throw new ServiceError('nothing pushed yet', 409);
	const r = await renderBinding(b, kind);
	const creds = openAccount(acc);
	let remote: Record<string, unknown>;
	try {
		remote = await getAdapter(kind).read(acc.remoteUuid, creds.password ?? '');
	} catch (e) {
		const msg = sanitize(e instanceof Error ? e.message : String(e), r.secretValues());
		throw new ServiceError(msg, e instanceof UpstreamError && e.isMissing ? 404 : 502);
	}
	const sr = strip(kind, remote);
	const sd = strip(kind, r.resolved);
	const values = r.secretValues();
	return {
		// what a push would change: remote -> desired
		changes: diffPaths(sr, sd),
		maskedRemote: maskConfig(sr, values) as object,
		maskedDesired: maskConfig(sd, values) as object
	};
}

export { KINDS };
