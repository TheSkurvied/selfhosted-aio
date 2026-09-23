/**
 * Job handlers: push, check, rotate, delete, import (spec section 8).
 * Every handler works on (personId, kind) or an accountId from the job row;
 * secret values exist only in memory while a handler runs.
 */
import { and, eq } from 'drizzle-orm';
import { getAdapter, UpstreamError } from '../adapters';
import { audit } from '../audit';
import { db, t } from '../db';
import type { Account, CheckStatus, InstanceKind, Job, JobType } from '../db/schema';
import {
	activeAccount,
	bindingFor,
	KIND_LABEL,
	kindOfInstance,
	openAccount,
	renderBinding,
	sealAccountCreds,
	type RenderedBinding
} from '../services/core';
import { configHash } from '../sync/hash';
import { diffPaths } from '../sync/diff';
import { strip } from '../sync/strip';
import { sanitize } from '../adapters/http';
import { notify } from './notify';

/** A failure that should not be retried (bad input, missing secrets, validation). */
export class PermanentJobError extends Error {
	readonly permanent = true;
}

export type JobContext = {
	progress: (msg: string) => Promise<void>;
	/** True on the final allowed attempt. */
	lastAttempt: boolean;
};

export type Handler = (job: Job, ctx: JobContext) => Promise<string | void>;

async function personName(personId: string | null): Promise<string> {
	if (!personId) return 'unknown';
	const [p] = await db.select({ n: t.people.displayName }).from(t.people).where(eq(t.people.id, personId));
	return p?.n ?? 'unknown';
}

function requireTarget(job: Job): { personId: string; kind: InstanceKind } {
	if (!job.personId || !job.kind) throw new PermanentJobError('job has no person/kind');
	return { personId: job.personId, kind: job.kind };
}

async function loadRendered(personId: string, kind: InstanceKind) {
	const b = await bindingFor(personId, kind);
	if (!b) throw new PermanentJobError(`no ${KIND_LABEL[kind]} binding`);
	const [person] = await db.select().from(t.people).where(eq(t.people.id, personId));
	if (!person) throw new PermanentJobError('person not found');
	const r = await renderBinding(b, kind);
	return { b, person, r };
}

function assertRenderable(r: RenderedBinding) {
	if (r.missingSecrets.length) throw new PermanentJobError(`missing secrets: ${r.missingSecrets.join(', ')}`);
	if (r.errors.length) throw new PermanentJobError(`invalid config: ${r.errors.slice(0, 3).join('; ')}`);
}

/** Store a failure on the account without leaking secret values. */
async function recordAccountError(accountId: string, err: unknown, scrub: string[], checkStatus?: CheckStatus) {
	const message = sanitize(err instanceof Error ? err.message : String(err), scrub);
	await db
		.update(t.accounts)
		.set({ lastError: message, ...(checkStatus ? { checkStatus } : {}) })
		.where(eq(t.accounts.id, accountId));
}

function rethrowSanitized(err: unknown, scrub: string[]): never {
	if (err instanceof UpstreamError) {
		const e = new UpstreamError(err.kind, err.op, err.code, err.status, sanitize(err.message.replace(`${err.kind} ${err.op}: `, ''), scrub), err.retryAfterMs);
		throw e;
	}
	if (err instanceof PermanentJobError) throw new PermanentJobError(sanitize(err.message, scrub));
	throw new Error(sanitize(err instanceof Error ? err.message : String(err), scrub));
}

// ---------------------------------------------------------------- push

const push: Handler = async (job, ctx) => {
	const { personId, kind } = requireTarget(job);
	const { b, person, r } = await loadRendered(personId, kind);
	if (person.disabled) throw new PermanentJobError('person is disabled');
	const scrub = r.secretValues();
	assertRenderable(r);
	const adapter = getAdapter(kind);
	let acc = await activeAccount(b.id);
	let before: Record<string, unknown> = {};
	let created = false;
	try {
		if (!acc || !acc.remoteUuid) {
			await ctx.progress('creating upstream config');
			let res;
			try {
				res = await adapter.create(r.resolved);
			} catch (e) {
				if (!acc) {
					// remember the failure so the binding shows "error"
					const [row] = await db
						.insert(t.accounts)
						.values({ bindingId: b.id, instanceId: b.instanceId, state: 'active', checkStatus: 'error' })
						.returning();
					acc = row;
				}
				await recordAccountError(acc.id, e, scrub, 'error');
				throw e;
			}
			created = true;
			const id = acc?.id ?? crypto.randomUUID();
			const sealed = sealAccountCreds(id, {
				password: res.password,
				manifestSecret: res.manifestSecret ?? null,
				manifestUrl: res.manifestUrl
			});
			if (acc) {
				await db
					.update(t.accounts)
					.set({ remoteUuid: res.uuid, ...sealed, keyVersion: 1, lastError: null })
					.where(eq(t.accounts.id, id));
			} else {
				await db.insert(t.accounts).values({
					id,
					bindingId: b.id,
					instanceId: b.instanceId,
					remoteUuid: res.uuid,
					...sealed,
					state: 'active'
				});
			}
			[acc] = await db.select().from(t.accounts).where(eq(t.accounts.id, id));
		} else {
			const creds = openAccount(acc);
			await ctx.progress('reading current config');
			try {
				before = strip(kind, await adapter.read(acc.remoteUuid, creds.password ?? ''));
			} catch (e) {
				if (e instanceof UpstreamError && e.isMissing) {
					await recordAccountError(acc.id, e, scrub, 'missing');
					throw new PermanentJobError('config is missing upstream (deleted or password changed); rotate to re-create it');
				}
				throw e;
			}
			await ctx.progress('updating upstream config');
			try {
				await adapter.update(acc.remoteUuid, creds.password ?? '', r.resolved);
			} catch (e) {
				if (!(e instanceof UpstreamError && e.transient) || ctx.lastAttempt) {
					await recordAccountError(acc.id, e, scrub, 'error');
				}
				throw e;
			}
		}
		await ctx.progress('verifying');
		const creds = openAccount(acc!);
		const readBack = await adapter.read(acc!.remoteUuid!, creds.password ?? '');
		await db
			.update(t.accounts)
			.set({
				desiredHash: r.desiredHash,
				pushedHash: r.desiredHash,
				remoteHash: configHash(kind, readBack),
				renderedFromVersionId: r.version.id,
				lastPushAt: new Date(),
				lastCheckAt: new Date(),
				lastError: null,
				checkStatus: 'ok'
			})
			.where(eq(t.accounts.id, acc!.id));
		const changed = diffPaths(before, strip(kind, r.resolved)).map((c) => c.path);
		await audit({
			actor: job.createdBy,
			action: created ? 'binding.create' : 'binding.push',
			targetType: 'person',
			targetId: personId,
			summary: `${created ? 'Created' : 'Pushed'} ${KIND_LABEL[kind]} config for ${person.displayName} (template v${r.version.version}, ${changed.length} path${changed.length === 1 ? '' : 's'} changed)`,
			diffPaths: changed.slice(0, 200)
		});
		return created ? 'created' : `${changed.length} paths changed`;
	} catch (e) {
		rethrowSanitized(e, scrub);
	}
};

// ---------------------------------------------------------------- check

async function runCheck(job: Job, ctx: JobContext): Promise<string> {
	const { personId, kind } = requireTarget(job);
	const b = await bindingFor(personId, kind);
	if (!b) return 'no binding';
	const acc = await activeAccount(b.id);
	if (!acc?.remoteUuid) return 'never pushed';
	const adapter = getAdapter(kind);
	const creds = openAccount(acc);
	let status: CheckStatus;
	let lastError: string | null = null;
	await ctx.progress('reading remote config');
	try {
		const remote = await adapter.read(acc.remoteUuid, creds.password ?? '');
		status = configHash(kind, remote) === acc.remoteHash ? 'ok' : 'drifted';
	} catch (e) {
		if (e instanceof UpstreamError && e.isMissing) {
			status = 'missing';
			lastError = sanitize(e.message);
		} else if (e instanceof UpstreamError && e.transient && !ctx.lastAttempt) {
			throw e;
		} else {
			status = 'error';
			lastError = sanitize(e instanceof Error ? e.message : String(e));
		}
	}
	await db
		.update(t.accounts)
		.set({ checkStatus: status, lastCheckAt: new Date(), lastError })
		.where(eq(t.accounts.id, acc.id));
	if (status !== acc.checkStatus) {
		const name = await personName(personId);
		await audit({
			actor: job.createdBy,
			action: 'binding.check',
			targetType: 'person',
			targetId: personId,
			summary: `${KIND_LABEL[kind]} config for ${name} is now ${status === 'ok' ? 'in sync with the last push' : status}`
		});
		if ((status === 'drifted' || status === 'missing') && acc.checkStatus !== status) {
			await notify(
				`AIO Manager: ${name} ${status}`,
				status === 'drifted'
					? `${name}'s ${KIND_LABEL[kind]} config was changed upstream. Review the diff in AIO Manager.`
					: `${name}'s ${KIND_LABEL[kind]} config is missing upstream (deleted or password changed).`,
				['warning']
			);
		}
	}
	if (status === 'error') throw new Error(lastError ?? 'check failed');
	return status;
}

// ---------------------------------------------------------------- rotate

const rotate: Handler = async (job, ctx) => {
	const { personId, kind } = requireTarget(job);
	const { b, person, r } = await loadRendered(personId, kind);
	const scrub = r.secretValues();
	assertRenderable(r);
	const adapter = getAdapter(kind);
	try {
		const old = await activeAccount(b.id);
		await ctx.progress('creating new upstream config');
		const res = await adapter.create(r.resolved);
		const id = crypto.randomUUID();
		await db.insert(t.accounts).values({
			id,
			bindingId: b.id,
			instanceId: b.instanceId,
			remoteUuid: res.uuid,
			...sealAccountCreds(id, {
				password: res.password,
				manifestSecret: res.manifestSecret ?? null,
				manifestUrl: res.manifestUrl
			}),
			state: 'rotating'
		});
		await ctx.progress('verifying');
		const readBack = await adapter.read(res.uuid, res.password);
		await db.transaction(async (tx) => {
			if (old) {
				await tx
					.update(t.accounts)
					.set({ state: 'retired', retiredAt: new Date() })
					.where(eq(t.accounts.id, old.id));
			}
			await tx
				.update(t.accounts)
				.set({
					state: 'active',
					desiredHash: r.desiredHash,
					pushedHash: r.desiredHash,
					remoteHash: configHash(kind, readBack),
					renderedFromVersionId: r.version.id,
					lastPushAt: new Date(),
					lastCheckAt: new Date(),
					checkStatus: 'ok'
				})
				.where(eq(t.accounts.id, id));
		});
		let deleteNote = '';
		if (old?.remoteUuid) {
			await ctx.progress('deleting old upstream config');
			try {
				await adapter.delete(old.remoteUuid, openAccount(old).password);
			} catch (e) {
				await recordAccountError(old.id, e, scrub);
				deleteNote = ' (old config could not be deleted upstream; see orphan report)';
			}
		}
		await audit({
			actor: job.createdBy,
			action: 'binding.rotate',
			targetType: 'person',
			targetId: personId,
			summary: `Rotated ${KIND_LABEL[kind]} config for ${person.displayName}: new manifest link${deleteNote}`
		});
		return `rotated${deleteNote}`;
	} catch (e) {
		rethrowSanitized(e, scrub);
	}
};

// ---------------------------------------------------------------- delete

const del: Handler = async (job, ctx) => {
	const accountId = job.accountId ?? (job.payloadJson?.accountId as string | undefined);
	if (!accountId) throw new PermanentJobError('delete job has no account');
	const [acc] = await db.select().from(t.accounts).where(eq(t.accounts.id, accountId));
	if (!acc) return 'account already gone';
	const kind = await kindOfInstance(acc.instanceId);
	if (acc.remoteUuid) {
		await ctx.progress('deleting upstream config');
		try {
			await getAdapter(kind).delete(acc.remoteUuid, openAccount(acc).password);
		} catch (e) {
			await recordAccountError(acc.id, e, []);
			throw e;
		}
	}
	await db
		.update(t.accounts)
		.set({ state: 'retired', retiredAt: acc.retiredAt ?? new Date(), lastError: null })
		.where(eq(t.accounts.id, acc.id));
	await audit({
		actor: job.createdBy,
		action: 'account.delete',
		targetType: job.personId ? 'person' : 'account',
		targetId: job.personId ?? acc.id,
		summary: `Deleted ${KIND_LABEL[kind]} config upstream`
	});
	return 'deleted';
};

export const handlers: Record<JobType, Handler> = {
	push,
	check: runCheck,
	rotate,
	delete: del,
	// imports run inline (they need credentials the queue must not hold);
	// the queued 'import' job verifies the imported account afterwards.
	import: runCheck
};

/** Accounts of a person that are still live upstream (used by revoke/delete). */
export async function liveAccountsOfBinding(bindingId: string): Promise<Account[]> {
	return db
		.select()
		.from(t.accounts)
		.where(and(eq(t.accounts.bindingId, bindingId), eq(t.accounts.state, 'active')));
}
