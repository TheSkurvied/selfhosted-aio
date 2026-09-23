import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { audit } from '../audit';
import { randomToken, sha256Hex } from '../crypto';
import { db, t } from '../db';
import type { InstanceKind } from '../db/schema';
import { env } from '../env';
import { instanceRows, KIND_LABEL, openAccount } from './core';
import { notFound, ServiceError } from './errors';

const LABEL: Record<InstanceKind, string> = {
	aiostreams: 'Streams (AIOStreams)',
	aiometadata: 'Catalogs and metadata (AIOMetadata)'
};

export async function createShareToken(
	actor: string,
	personId: string,
	opts: { expiresInDays?: number | null; maxViews?: number | null } = {}
): Promise<{ id: string; url: string }> {
	const [p] = await db.select().from(t.people).where(eq(t.people.id, personId));
	if (!p) throw notFound('person');
	const days = opts.expiresInDays ?? null;
	const maxViews = opts.maxViews ?? null;
	if (days !== null && (!Number.isFinite(days) || days <= 0 || days > 3650))
		throw new ServiceError('expiresInDays must be between 0 and 3650');
	if (maxViews !== null && (!Number.isInteger(maxViews) || maxViews < 1))
		throw new ServiceError('maxViews must be a positive integer');
	const token = randomToken(32);
	const id = crypto.randomUUID();
	await db.insert(t.shareTokens).values({
		id,
		personId,
		tokenHash: sha256Hex(token),
		expiresAt: days !== null ? new Date(Date.now() + days * 86400_000) : null,
		maxViews,
		createdBy: actor
	});
	await audit({
		actor,
		action: 'share.create',
		targetType: 'person',
		targetId: personId,
		summary: `Created share link for ${p.displayName}${days !== null ? `, expires in ${days} day(s)` : ''}${maxViews !== null ? `, max ${maxViews} view(s)` : ''}`
	});
	return { id, url: `${env.PUBLIC_URL}/s/${token}` };
}

export async function revokeShareToken(actor: string, tokenId: string): Promise<void> {
	const [row] = await db
		.update(t.shareTokens)
		.set({ revokedAt: new Date() })
		.where(and(eq(t.shareTokens.id, tokenId), isNull(t.shareTokens.revokedAt)))
		.returning();
	if (!row) {
		const [exists] = await db
			.select({ id: t.shareTokens.id })
			.from(t.shareTokens)
			.where(eq(t.shareTokens.id, tokenId));
		if (!exists) throw notFound('share link');
		return; // already revoked
	}
	await audit({
		actor,
		action: 'share.revoke',
		targetType: 'person',
		targetId: row.personId,
		summary: 'Revoked a share link'
	});
}

export function stremioUrl(manifestUrl: string): string {
	return manifestUrl.replace(/^https?:\/\//i, 'stremio://');
}

export async function resolveShareToken(token: string): Promise<null | {
	displayName: string;
	expiresAt: Date | null;
	links: Array<{
		kind: InstanceKind;
		label: string;
		manifestUrl: string;
		stremioUrl: string;
		qrSvg: string;
	}>;
}> {
	if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
	const hash = sha256Hex(token);
	const [row] = await db
		.select({ tok: t.shareTokens, person: t.people })
		.from(t.shareTokens)
		.innerJoin(t.people, eq(t.people.id, t.shareTokens.personId))
		.where(eq(t.shareTokens.tokenHash, hash));
	if (!row || row.person.disabled) return null;
	// count the view atomically, re-checking every limit in the same statement
	const now = new Date();
	const [counted] = await db
		.update(t.shareTokens)
		.set({ views: sql`${t.shareTokens.views} + 1` })
		.where(
			and(
				eq(t.shareTokens.id, row.tok.id),
				isNull(t.shareTokens.revokedAt),
				or(isNull(t.shareTokens.expiresAt), gt(t.shareTokens.expiresAt, now)),
				or(isNull(t.shareTokens.maxViews), lt(t.shareTokens.views, t.shareTokens.maxViews))
			)
		)
		.returning({ id: t.shareTokens.id });
	if (!counted) return null;
	const insts = await instanceRows();
	const kindById = new Map([...insts].map(([k, r]) => [r.id, k]));
	const accts = await db
		.select({ acc: t.accounts })
		.from(t.accounts)
		.innerJoin(t.personBindings, eq(t.personBindings.id, t.accounts.bindingId))
		.where(and(eq(t.personBindings.personId, row.person.id), eq(t.accounts.state, 'active')));
	const links = [];
	for (const kind of ['aiostreams', 'aiometadata'] as const) {
		const a = accts.find((x) => kindById.get(x.acc.instanceId) === kind && x.acc.remoteUuid);
		if (!a) continue;
		let manifestUrl: string | null;
		try {
			manifestUrl = openAccount(a.acc).manifestUrl;
		} catch {
			manifestUrl = null;
		}
		if (!manifestUrl) continue;
		const qrSvg = await QRCode.toString(manifestUrl, {
			type: 'svg',
			margin: 1,
			errorCorrectionLevel: 'M'
		});
		links.push({
			kind,
			label: LABEL[kind] ?? KIND_LABEL[kind],
			manifestUrl,
			stremioUrl: stremioUrl(manifestUrl),
			qrSvg
		});
	}
	return { displayName: row.person.displayName, expiresAt: row.tok.expiresAt, links };
}
