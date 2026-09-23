import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { audit } from '../audit';
import { db, t } from '../db';
import { applyMergePatch } from '../sync/merge-patch';
import { requiredSecrets, SECRET_NAME } from '../sync/placeholders';
import { upsertSecret } from './core';
import { notFound, ServiceError } from './errors';

function checkName(name: string): string {
	const n = String(name ?? '').trim();
	if (!SECRET_NAME.test(n)) {
		throw new ServiceError(
			'secret names use letters, digits, "_", "-" and "." (max 64), starting with a letter or digit'
		);
	}
	return n;
}

export async function listSharedSecrets(): Promise<
	Array<{
		name: string;
		hint: string;
		updatedAt: Date;
		usedByTemplates: string[];
		peopleRelying: number;
	}>
> {
	const shared = await db
		.select()
		.from(t.secrets)
		.where(eq(t.secrets.scope, 'shared'))
		.orderBy(asc(t.secrets.name));
	if (shared.length === 0) return [];
	const tpls = await db
		.select({ id: t.templates.id, name: t.templates.name, req: t.templateVersions.requiredSecrets })
		.from(t.templates)
		.innerJoin(t.templateVersions, eq(t.templateVersions.id, t.templates.currentVersionId));
	// which names each binding needs (effective version + overrides)
	const bindings = await db.select().from(t.personBindings);
	const versionIds = new Set<string>();
	const tplCur = new Map<string, string | null>();
	for (const tp of await db
		.select({ id: t.templates.id, cur: t.templates.currentVersionId })
		.from(t.templates)) {
		tplCur.set(tp.id, tp.cur);
	}
	for (const b of bindings) {
		const v = b.pinnedVersionId ?? tplCur.get(b.templateId);
		if (v) versionIds.add(v);
	}
	const versions = versionIds.size
		? await db
				.select()
				.from(t.templateVersions)
				.where(inArray(t.templateVersions.id, [...versionIds]))
		: [];
	const vById = new Map(versions.map((v) => [v.id, v]));
	const personSecrets = await db
		.select({ personId: t.secrets.personId, name: t.secrets.name })
		.from(t.secrets)
		.where(eq(t.secrets.scope, 'person'));
	const own = new Set(personSecrets.map((s) => `${s.personId}\u0000${s.name}`));
	const needsByPerson = new Map<string, Set<string>>();
	for (const b of bindings) {
		const v = vById.get(b.pinnedVersionId ?? tplCur.get(b.templateId) ?? '');
		if (!v) continue;
		const names = requiredSecrets(applyMergePatch(v.bodyJson, b.overridesJson ?? {}));
		if (!needsByPerson.has(b.personId)) needsByPerson.set(b.personId, new Set());
		for (const n of names) needsByPerson.get(b.personId)!.add(n);
	}
	return shared.map((s) => {
		let relying = 0;
		for (const [pid, names] of needsByPerson)
			if (names.has(s.name) && !own.has(`${pid}\u0000${s.name}`)) relying++;
		return {
			name: s.name,
			hint: s.hint,
			updatedAt: s.updatedAt,
			usedByTemplates: tpls.filter((x) => x.req.includes(s.name)).map((x) => x.name),
			peopleRelying: relying
		};
	});
}

export async function setSecret(
	actor: string,
	scope: 'shared' | 'person',
	personId: string | null,
	name: string,
	value: string
): Promise<void> {
	if (scope !== 'shared' && scope !== 'person')
		throw new ServiceError('scope must be shared or person');
	const n = checkName(name);
	if (typeof value !== 'string' || value.length === 0) throw new ServiceError('value is required');
	if (value.length > 8192) throw new ServiceError('value is too long');
	let who = '';
	if (scope === 'person') {
		if (!personId) throw new ServiceError('personId is required for a person secret');
		const [p] = await db.select().from(t.people).where(eq(t.people.id, personId));
		if (!p) throw notFound('person');
		who = ` for ${p.displayName}`;
	}
	const res = await upsertSecret(scope, scope === 'person' ? personId : null, n, value);
	await audit({
		actor,
		action: res === 'created' ? 'secret.create' : 'secret.update',
		targetType: scope === 'person' ? 'person' : 'secret',
		targetId: scope === 'person' ? personId! : n,
		summary: `${res === 'created' ? 'Added' : 'Replaced'} ${scope} secret ${n}${who}`
	});
}

export async function deleteSecret(
	actor: string,
	scope: 'shared' | 'person',
	personId: string | null,
	name: string
): Promise<void> {
	const n = checkName(name);
	const rows = await db
		.delete(t.secrets)
		.where(
			and(
				eq(t.secrets.scope, scope),
				scope === 'person' && personId
					? eq(t.secrets.personId, personId)
					: isNull(t.secrets.personId),
				eq(t.secrets.name, n)
			)
		)
		.returning({ id: t.secrets.id });
	if (rows.length === 0) throw notFound('secret');
	await audit({
		actor,
		action: 'secret.delete',
		targetType: scope === 'person' ? 'person' : 'secret',
		targetId: scope === 'person' ? personId! : n,
		summary: `Deleted ${scope} secret ${n}`
	});
}
