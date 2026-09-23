import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getAdapter, UpstreamError } from '../adapters';
import { sanitize } from '../adapters/http';
import { audit } from '../audit';
import { db, t } from '../db';
import type { InstanceKind } from '../db/schema';
import { enqueue } from '../jobs/queue';
import { diffPaths } from '../sync/diff';
import { configHash } from '../sync/hash';
import { isPlainObject, walkLeaves, getAt, setAt, clone } from '../sync/json';
import { createMergePatch } from '../sync/merge-patch';
import {
	hasPlaceholder,
	isPlaceholderString,
	placeholder,
	requiredSecrets,
	substitutePlaceholders
} from '../sync/placeholders';
import { applyExtraction, extractSecrets } from '../sync/extract';
import { render } from '../sync/render';
import { strip } from '../sync/strip';
import {
	activeAccount,
	assertKind,
	effectiveVersion,
	instanceRows,
	KIND_LABEL,
	openAccount,
	requireBinding,
	secretLookup,
	secretRows,
	statusesFor,
	SYNC_STATUSES,
	upsertSecret,
	type SyncStatus
} from './core';
import { notFound, ServiceError } from './errors';

async function requirePerson(id: string) {
	const [p] = await db.select().from(t.people).where(eq(t.people.id, id));
	if (!p) throw notFound('person');
	return p;
}

export async function pushBinding(
	actor: string,
	personId: string,
	kindIn: InstanceKind
): Promise<{ jobId: string }> {
	const kind = assertKind(kindIn);
	const p = await requirePerson(personId);
	if (p.disabled) throw new ServiceError('person is disabled', 409);
	await requireBinding(personId, kind);
	return { jobId: await enqueue({ type: 'push', createdBy: actor, personId, kind }) };
}

export async function checkBinding(
	actor: string,
	personId: string,
	kindIn: InstanceKind
): Promise<{ jobId: string }> {
	const kind = assertKind(kindIn);
	await requirePerson(personId);
	await requireBinding(personId, kind);
	return { jobId: await enqueue({ type: 'check', createdBy: actor, personId, kind }) };
}

export async function rotateBinding(
	actor: string,
	personId: string,
	kindIn: InstanceKind
): Promise<{ jobId: string }> {
	const kind = assertKind(kindIn);
	const p = await requirePerson(personId);
	if (p.disabled) throw new ServiceError('person is disabled', 409);
	await requireBinding(personId, kind);
	return { jobId: await enqueue({ type: 'rotate', createdBy: actor, personId, kind }) };
}

/**
 * Convert a remote config into overrides for `templateBody`:
 *  1. where the template has a whole-string placeholder and the remote holds a
 *     literal at the same path, the literal becomes (or updates) the person's
 *     secret of that name, so the template's placeholder is kept;
 *  2. other values equal to a stored secret become that placeholder;
 *  3. remaining literal credentials become new person secrets.
 * Returns the overrides and the names of person secrets created or updated.
 */
export async function remoteToOverrides(
	kind: InstanceKind,
	personId: string,
	remote: Record<string, unknown>,
	templateBody: Record<string, unknown>
): Promise<{ overrides: Record<string, unknown>; createdSecrets: string[] }> {
	let sec = await secretRows(personId);
	let { lookup } = secretLookup(sec);
	let body = clone(strip(kind, remote));
	const created: string[] = [];
	const setOwn = new Map<string, string>();
	const restores: Array<{ segs: Array<string | number>; tv: string }> = [];
	walkLeaves(body, (v, segs) => {
		if (typeof v !== 'string') return;
		const tv = getAt(templateBody, segs);
		if (typeof tv !== 'string' || !hasPlaceholder(tv)) return;
		const resolved = substitutePlaceholders(tv, lookup);
		if (resolved.missing.length === 0 && resolved.value === v) {
			restores.push({ segs, tv });
		} else if (isPlaceholderString(tv) && v.length > 0 && !hasPlaceholder(v)) {
			const name = requiredSecrets(tv)[0];
			if (!setOwn.has(name) || setOwn.get(name) === v) {
				setOwn.set(name, v);
				restores.push({ segs, tv });
			}
		}
	});
	for (const [name, value] of setOwn) {
		if (lookup(name) === value) continue;
		await upsertSecret('person', personId, name, value);
		created.push(name);
	}
	if (setOwn.size) {
		sec = await secretRows(personId);
		({ lookup } = secretLookup(sec));
	}
	for (const r of restores) setAt(body, r.segs, r.tv);
	// values that equal a stored secret (person first, then shared) -> that placeholder
	const byValue = new Map<string, string>();
	for (const name of [...sec.shared.keys(), ...sec.person.keys()]) {
		const v = lookup(name);
		if (v && v.length >= 4) byValue.set(v, name);
	}
	walkLeaves(body, (v, segs) => {
		if (typeof v === 'string' && byValue.has(v)) setAt(body, segs, placeholder(byValue.get(v)!));
	});
	// remaining literal credentials -> new person secrets
	const ex = extractSecrets(body);
	const picks: Array<{ path: string; name: string }> = [];
	const nameFor = new Map<string, string>();
	for (const f of ex.found) {
		let name = nameFor.get(f.value);
		if (!name) {
			name = f.suggestedName;
			for (let i = 2; ; i++) {
				const existing = sec.person.get(name) ?? sec.shared.get(name);
				if (!existing || lookup(name) === f.value) break;
				name = `${f.suggestedName}_${i}`;
			}
			nameFor.set(f.value, name);
			if (lookup(name) !== f.value) {
				await upsertSecret('person', personId, name, f.value);
				created.push(name);
			}
		}
		picks.push({ path: f.path, name });
	}
	if (picks.length) body = applyExtraction(body, picks) as Record<string, unknown>;
	const patch = createMergePatch(templateBody, body);
	return { overrides: isPlainObject(patch) ? patch : {}, createdSecrets: created };
}

export async function adoptRemote(
	actor: string,
	personId: string,
	kindIn: InstanceKind
): Promise<void> {
	const kind = assertKind(kindIn);
	const p = await requirePerson(personId);
	const b = await requireBinding(personId, kind);
	const acc = await activeAccount(b.id);
	if (!acc?.remoteUuid) throw new ServiceError('nothing pushed yet', 409);
	const version = await effectiveVersion(b);
	const creds = openAccount(acc);
	let remote: Record<string, unknown>;
	try {
		remote = await getAdapter(kind).read(acc.remoteUuid, creds.password ?? '');
	} catch (e) {
		throw new ServiceError(
			sanitize(e instanceof Error ? e.message : String(e)),
			e instanceof UpstreamError && e.isMissing ? 404 : 502
		);
	}
	const { overrides, createdSecrets } = await remoteToOverrides(
		kind,
		personId,
		remote,
		version.bodyJson
	);
	const changed = diffPaths(b.overridesJson ?? {}, overrides).map((c) => `overrides.${c.path}`);
	await db
		.update(t.personBindings)
		.set({ overridesJson: overrides, updatedAt: new Date() })
		.where(eq(t.personBindings.id, b.id));
	// the desired config now equals the remote one: record it as in sync
	const r = render({
		kind,
		base: version.bodyJson,
		overrides,
		lookup: secretLookup(await secretRows(personId)).lookup
	});
	const remoteHash = configHash(kind, remote);
	await db
		.update(t.accounts)
		.set({
			desiredHash: r.desiredHash,
			pushedHash: r.desiredHash,
			remoteHash,
			renderedFromVersionId: version.id,
			lastCheckAt: new Date(),
			checkStatus: 'ok',
			lastError: null
		})
		.where(eq(t.accounts.id, acc.id));
	await audit({
		actor,
		action: 'binding.adopt',
		targetType: 'person',
		targetId: personId,
		summary: `Adopted remote ${KIND_LABEL[kind]} changes into overrides for ${p.displayName}${createdSecrets.length ? `; person secrets set: ${createdSecrets.join(', ')}` : ''}`,
		diffPaths: changed.slice(0, 200)
	});
}

export async function revokePerson(actor: string, personId: string): Promise<{ jobIds: string[] }> {
	const p = await requirePerson(personId);
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	await db
		.update(t.people)
		.set({ disabled: true, updatedAt: new Date() })
		.where(eq(t.people.id, personId));
	await db
		.update(t.shareTokens)
		.set({ revokedAt: new Date() })
		.where(and(eq(t.shareTokens.personId, personId), isNull(t.shareTokens.revokedAt)));
	const bindings = await db
		.select()
		.from(t.personBindings)
		.where(eq(t.personBindings.personId, personId));
	const jobIds: string[] = [];
	for (const b of bindings) {
		const kind = kindById.get(b.instanceId)!;
		const accs = await db
			.select()
			.from(t.accounts)
			.where(
				and(eq(t.accounts.bindingId, b.id), inArray(t.accounts.state, ['active', 'rotating']))
			);
		for (const a of accs) {
			await db
				.update(t.accounts)
				.set({ state: 'retired', retiredAt: new Date() })
				.where(eq(t.accounts.id, a.id));
			if (a.remoteUuid) {
				jobIds.push(
					await enqueue({
						type: 'delete',
						createdBy: actor,
						personId,
						kind,
						accountId: a.id,
						payload: { accountId: a.id }
					})
				);
			}
		}
	}
	await audit({
		actor,
		action: 'person.revoke',
		targetType: 'person',
		targetId: personId,
		summary: `Revoked ${p.displayName}: disabled, share links revoked, ${jobIds.length} upstream config(s) queued for deletion`
	});
	return { jobIds };
}

export async function bulk(
	actor: string,
	action: 'push' | 'check',
	personIds: string[]
): Promise<{ jobIds: string[] }> {
	if (action !== 'push' && action !== 'check')
		throw new ServiceError('action must be push or check');
	if (!Array.isArray(personIds) || personIds.length === 0) return { jobIds: [] };
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const rows = await db
		.select({ b: t.personBindings, disabled: t.people.disabled })
		.from(t.personBindings)
		.innerJoin(t.people, eq(t.people.id, t.personBindings.personId))
		.where(inArray(t.personBindings.personId, personIds));
	const jobIds: string[] = [];
	for (const { b, disabled } of rows) {
		if (action === 'push' && disabled) continue;
		jobIds.push(
			await enqueue({
				type: action,
				createdBy: actor,
				personId: b.personId,
				kind: kindById.get(b.instanceId)!
			})
		);
	}
	await audit({
		actor,
		action: `bulk.${action}`,
		summary: `Queued ${jobIds.length} ${action} job(s) for ${personIds.length} people`
	});
	return { jobIds };
}

async function allBindingsWithStatus() {
	const rows = await db
		.select({ b: t.personBindings, disabled: t.people.disabled })
		.from(t.personBindings)
		.innerJoin(t.people, eq(t.people.id, t.personBindings.personId));
	const st = await statusesFor(rows.map((r) => r.b));
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	return rows.map((r) => ({
		...r,
		kind: kindById.get(r.b.instanceId)!,
		status: st.get(r.b.id)!.status
	}));
}

export async function pushAllPending(actor: string): Promise<{ jobIds: string[] }> {
	const all = await allBindingsWithStatus();
	const jobIds: string[] = [];
	for (const x of all) {
		if (x.disabled) continue;
		if (x.status === 'pending' || x.status === 'never_pushed') {
			jobIds.push(
				await enqueue({ type: 'push', createdBy: actor, personId: x.b.personId, kind: x.kind })
			);
		}
	}
	await audit({
		actor,
		action: 'bulk.push',
		summary: `Queued ${jobIds.length} push(es) for pending bindings`
	});
	return { jobIds };
}

export async function checkAll(actor: string): Promise<{ jobIds: string[] }> {
	const rows = await db
		.select({ b: t.personBindings, acc: t.accounts })
		.from(t.personBindings)
		.innerJoin(
			t.accounts,
			and(eq(t.accounts.bindingId, t.personBindings.id), eq(t.accounts.state, 'active'))
		);
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const jobIds: string[] = [];
	for (const { b, acc } of rows) {
		if (!acc.remoteUuid) continue;
		jobIds.push(
			await enqueue({
				type: 'check',
				createdBy: actor,
				personId: b.personId,
				kind: kindById.get(b.instanceId)!
			})
		);
	}
	if (actor !== 'system' || jobIds.length) {
		await audit({ actor, action: 'bulk.check', summary: `Queued ${jobIds.length} check(s)` });
	}
	return { jobIds };
}

export async function syncSummary(): Promise<Record<SyncStatus, number>> {
	const out = Object.fromEntries(SYNC_STATUSES.map((s) => [s, 0])) as Record<SyncStatus, number>;
	const all = await allBindingsWithStatus();
	for (const x of all) out[x.status]++;
	// unbound = (enabled person, kind) pairs without a binding
	const people = await db
		.select({ id: t.people.id })
		.from(t.people)
		.where(eq(t.people.disabled, false));
	const bound = new Set(all.map((x) => `${x.b.personId}:${x.kind}`));
	for (const p of people) {
		for (const k of ['aiostreams', 'aiometadata'] as const)
			if (!bound.has(`${p.id}:${k}`)) out.unbound++;
	}
	return out;
}
