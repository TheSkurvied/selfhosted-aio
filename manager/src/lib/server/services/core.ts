/**
 * Shared engine internals: instances, secrets, accounts (sealed columns),
 * rendering a binding and deriving its sync status. Not part of the public
 * service API (index.ts re-exports only the contract functions).
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { aadFor, hint, open, seal } from '../crypto';
import { db, t } from '../db';
import type {
	Account,
	CheckStatus,
	InstanceKind,
	PersonBinding,
	Secret,
	TemplateVersion
} from '../db/schema';
import { seedInstances } from '../instances';
import { render, type RenderResult } from '../sync/render';
import { notFound, ServiceError } from './errors';

export type SyncStatus =
	'in_sync' | 'pending' | 'drifted' | 'missing' | 'error' | 'unbound' | 'never_pushed';

export const SYNC_STATUSES: readonly SyncStatus[] = [
	'in_sync',
	'pending',
	'drifted',
	'missing',
	'error',
	'unbound',
	'never_pushed'
];

export const KINDS: readonly InstanceKind[] = ['aiostreams', 'aiometadata'];

export function assertKind(kind: string): InstanceKind {
	if (kind !== 'aiostreams' && kind !== 'aiometadata')
		throw new ServiceError(`unknown instance kind: ${kind}`, 400);
	return kind;
}

export const KIND_LABEL: Record<InstanceKind, string> = {
	aiostreams: 'AIOStreams',
	aiometadata: 'AIOMetadata'
};

// ---------------------------------------------------------------- instances

export type InstanceRow = typeof t.instances.$inferSelect;

export async function instanceRows(): Promise<Map<InstanceKind, InstanceRow>> {
	let rows = await db.select().from(t.instances);
	if (rows.length < KINDS.length) {
		await seedInstances();
		rows = await db.select().from(t.instances);
	}
	return new Map(rows.map((r) => [r.kind, r]));
}

export async function instanceRow(kind: InstanceKind): Promise<InstanceRow> {
	const row = (await instanceRows()).get(kind);
	if (!row) throw new ServiceError(`instance ${kind} not configured`, 500);
	return row;
}

export async function kindOfInstance(instanceId: string): Promise<InstanceKind> {
	for (const [k, r] of await instanceRows()) if (r.id === instanceId) return k;
	throw new ServiceError('unknown instance', 500);
}

// ---------------------------------------------------------------- secrets

export function openSecret(row: Pick<Secret, 'id' | 'valueEnc'>): string {
	return open(row.valueEnc, aadFor('secrets', 'value_enc', row.id));
}

export type SecretScopeMap = {
	person: Map<string, Secret>;
	shared: Map<string, Secret>;
};

export async function secretRows(personId: string | null): Promise<SecretScopeMap> {
	const rows = await db
		.select()
		.from(t.secrets)
		.where(
			personId
				? or(
						eq(t.secrets.scope, 'shared'),
						and(eq(t.secrets.scope, 'person'), eq(t.secrets.personId, personId))
					)
				: eq(t.secrets.scope, 'shared')
		);
	const out: SecretScopeMap = { person: new Map(), shared: new Map() };
	for (const r of rows) (r.scope === 'shared' ? out.shared : out.person).set(r.name, r);
	return out;
}

/** Lookup function for render(): person secret first, then shared. Also returns every value used (for masking/scrubbing). */
export function secretLookup(m: SecretScopeMap): {
	lookup: (name: string) => string | undefined;
	values: () => string[];
} {
	const cache = new Map<string, string>();
	const lookup = (name: string) => {
		if (cache.has(name)) return cache.get(name);
		const row = m.person.get(name) ?? m.shared.get(name);
		if (!row) return undefined;
		const v = openSecret(row);
		cache.set(name, v);
		return v;
	};
	return {
		lookup,
		values: () => {
			// every secret visible to this person (masking should hide all of them)
			for (const n of new Set([...m.person.keys(), ...m.shared.keys()])) lookup(n);
			return [...cache.values()];
		}
	};
}

/** Every stored secret value (for scrubbing error messages). Small deployments only. */
export async function allSecretValues(): Promise<string[]> {
	const rows = await db.select({ id: t.secrets.id, valueEnc: t.secrets.valueEnc }).from(t.secrets);
	const out: string[] = [];
	for (const r of rows) {
		try {
			out.push(openSecret(r));
		} catch {
			// undecryptable row: nothing to scrub
		}
	}
	return out;
}

export async function upsertSecret(
	scope: 'shared' | 'person',
	personId: string | null,
	name: string,
	value: string
): Promise<'created' | 'updated'> {
	const [existing] = await db
		.select()
		.from(t.secrets)
		.where(
			and(
				eq(t.secrets.scope, scope),
				personId ? eq(t.secrets.personId, personId) : isNull(t.secrets.personId),
				eq(t.secrets.name, name)
			)
		);
	const id = existing?.id ?? crypto.randomUUID();
	const valueEnc = seal(value, aadFor('secrets', 'value_enc', id));
	if (existing) {
		await db
			.update(t.secrets)
			.set({ valueEnc, hint: hint(value), keyVersion: 1, updatedAt: new Date() })
			.where(eq(t.secrets.id, id));
		return 'updated';
	}
	await db.insert(t.secrets).values({ id, scope, personId, name, valueEnc, hint: hint(value) });
	return 'created';
}

// ---------------------------------------------------------------- accounts

export type AccountCreds = {
	password: string | null;
	manifestSecret: string | null;
	manifestUrl: string | null;
};

export function openAccount(a: Account): AccountCreds {
	const o = (col: 'password_enc' | 'manifest_secret_enc' | 'manifest_url_enc', v: string | null) =>
		v ? open(v, aadFor('accounts', col, a.id)) : null;
	return {
		password: o('password_enc', a.passwordEnc),
		manifestSecret: o('manifest_secret_enc', a.manifestSecretEnc),
		manifestUrl: o('manifest_url_enc', a.manifestUrlEnc)
	};
}

export function sealAccountCreds(accountId: string, c: Partial<AccountCreds>) {
	const s = (col: string, v: string | null | undefined) =>
		v ? seal(v, aadFor('accounts', col, accountId)) : null;
	const out: Partial<Pick<Account, 'passwordEnc' | 'manifestSecretEnc' | 'manifestUrlEnc'>> = {};
	if (c.password !== undefined) out.passwordEnc = s('password_enc', c.password);
	if (c.manifestSecret !== undefined)
		out.manifestSecretEnc = s('manifest_secret_enc', c.manifestSecret);
	if (c.manifestUrl !== undefined) out.manifestUrlEnc = s('manifest_url_enc', c.manifestUrl);
	return out;
}

/** The binding's current account (state active), if any. */
export async function activeAccount(bindingId: string): Promise<Account | null> {
	const [row] = await db
		.select()
		.from(t.accounts)
		.where(and(eq(t.accounts.bindingId, bindingId), eq(t.accounts.state, 'active')))
		.orderBy(t.accounts.createdAt)
		.limit(1);
	return row ?? null;
}

export async function activeAccountsFor(bindingIds: string[]): Promise<Map<string, Account>> {
	if (bindingIds.length === 0) return new Map();
	const rows = await db
		.select()
		.from(t.accounts)
		.where(and(inArray(t.accounts.bindingId, bindingIds), eq(t.accounts.state, 'active')));
	const out = new Map<string, Account>();
	for (const r of rows) if (r.bindingId && !out.has(r.bindingId)) out.set(r.bindingId, r);
	return out;
}

// ---------------------------------------------------------------- bindings + rendering

export async function bindingFor(
	personId: string,
	kind: InstanceKind
): Promise<PersonBinding | null> {
	const inst = await instanceRow(kind);
	const [row] = await db
		.select()
		.from(t.personBindings)
		.where(and(eq(t.personBindings.personId, personId), eq(t.personBindings.instanceId, inst.id)));
	return row ?? null;
}

export async function requireBinding(personId: string, kind: InstanceKind): Promise<PersonBinding> {
	const b = await bindingFor(personId, kind);
	if (!b) throw notFound(`${KIND_LABEL[kind]} binding`);
	return b;
}

export async function effectiveVersion(
	b: Pick<PersonBinding, 'templateId' | 'pinnedVersionId'>
): Promise<TemplateVersion> {
	let versionId = b.pinnedVersionId;
	if (!versionId) {
		const [tpl] = await db.select().from(t.templates).where(eq(t.templates.id, b.templateId));
		if (!tpl) throw notFound('template');
		versionId = tpl.currentVersionId;
	}
	if (!versionId) throw new ServiceError('template has no versions', 409);
	const [v] = await db
		.select()
		.from(t.templateVersions)
		.where(eq(t.templateVersions.id, versionId));
	if (!v) throw notFound('template version');
	return v;
}

export type RenderedBinding = RenderResult & {
	kind: InstanceKind;
	version: TemplateVersion;
	/** Every secret value visible to the person (for masking and scrubbing). */
	secretValues: () => string[];
};

export async function renderBinding(
	b: PersonBinding,
	kind?: InstanceKind
): Promise<RenderedBinding> {
	const k = kind ?? (await kindOfInstance(b.instanceId));
	const version = await effectiveVersion(b);
	const secrets = secretLookup(await secretRows(b.personId));
	const r = render({
		kind: k,
		base: version.bodyJson,
		overrides: b.overridesJson ?? {},
		lookup: secrets.lookup
	});
	return { ...r, kind: k, version, secretValues: secrets.values };
}

/** Derive the displayed status from the stored account state and the current desired hash. */
export function deriveStatus(account: Account | null, desiredHash: string | null): SyncStatus {
	if (!account) return 'never_pushed';
	if (!account.remoteUuid) return account.checkStatus === 'error' ? 'error' : 'never_pushed';
	const cs: CheckStatus | null = account.checkStatus;
	if (cs === 'missing') return 'missing';
	if (cs === 'error') return 'error';
	if (cs === 'drifted') return 'drifted';
	if (desiredHash !== null && desiredHash !== account.pushedHash) return 'pending';
	return 'in_sync';
}

/**
 * Status for many bindings at once. Renders every binding (secrets are
 * decrypted in memory only) so "pending" is exact.
 */
export async function statusesFor(bindings: PersonBinding[]): Promise<
	Map<
		string,
		{
			status: SyncStatus;
			version: TemplateVersion | null;
			account: Account | null;
			desiredHash: string | null;
			missingSecrets: string[];
		}
	>
> {
	const out = new Map<
		string,
		{
			status: SyncStatus;
			version: TemplateVersion | null;
			account: Account | null;
			desiredHash: string | null;
			missingSecrets: string[];
		}
	>();
	if (bindings.length === 0) return out;
	const accounts = await activeAccountsFor(bindings.map((b) => b.id));
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const tpls = await db
		.select()
		.from(t.templates)
		.where(inArray(t.templates.id, [...new Set(bindings.map((b) => b.templateId))]));
	const versionIds = new Set<string>();
	for (const b of bindings) if (b.pinnedVersionId) versionIds.add(b.pinnedVersionId);
	for (const tp of tpls) if (tp.currentVersionId) versionIds.add(tp.currentVersionId);
	const versions = versionIds.size
		? await db
				.select()
				.from(t.templateVersions)
				.where(inArray(t.templateVersions.id, [...versionIds]))
		: [];
	const vById = new Map(versions.map((v) => [v.id, v]));
	const tById = new Map(tpls.map((tp) => [tp.id, tp]));
	const personIds = [...new Set(bindings.map((b) => b.personId))];
	const secretRowsAll = await db
		.select()
		.from(t.secrets)
		.where(or(eq(t.secrets.scope, 'shared'), inArray(t.secrets.personId, personIds)));
	const shared = new Map<string, Secret>();
	const byPerson = new Map<string, Map<string, Secret>>();
	for (const s of secretRowsAll) {
		if (s.scope === 'shared') shared.set(s.name, s);
		else if (s.personId) {
			if (!byPerson.has(s.personId)) byPerson.set(s.personId, new Map());
			byPerson.get(s.personId)!.set(s.name, s);
		}
	}
	for (const b of bindings) {
		const account = accounts.get(b.id) ?? null;
		const vid = b.pinnedVersionId ?? tById.get(b.templateId)?.currentVersionId ?? null;
		const version = vid ? (vById.get(vid) ?? null) : null;
		const kind = kindById.get(b.instanceId) ?? 'aiostreams';
		let desiredHash: string | null = null;
		let missingSecrets: string[] = [];
		if (version) {
			const { lookup } = secretLookup({ person: byPerson.get(b.personId) ?? new Map(), shared });
			try {
				const r = render({
					kind,
					base: version.bodyJson,
					overrides: b.overridesJson ?? {},
					lookup
				});
				desiredHash = r.desiredHash;
				missingSecrets = r.missingSecrets;
			} catch {
				desiredHash = null;
			}
		}
		out.set(b.id, {
			status: deriveStatus(account, desiredHash),
			version,
			account,
			desiredHash,
			missingSecrets
		});
	}
	return out;
}
