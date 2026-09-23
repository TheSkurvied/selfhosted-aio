/**
 * Instances come from env only. seedInstances() upserts one row per kind at
 * boot, with the upstream credentials sealed into auth_json_enc.
 */
import { eq } from 'drizzle-orm';
import { aadFor, open, seal } from './crypto';
import { db, t } from './db';
import type { InstanceKind } from './db/schema';
import { env } from './env';
import { log } from './log';

export type AiostreamsAuth = { username?: string; password?: string };
export type AiometadataAuth = { adminKey: string; addonPassword?: string };
export type InstanceAuth = AiostreamsAuth | AiometadataAuth;

function desired(): Array<{
	kind: InstanceKind;
	internalUrl: string;
	publicUrl: string;
	auth: InstanceAuth | null;
}> {
	const aiostreamsAuth: AiostreamsAuth | null =
		env.AIOSTREAMS_USERNAME || env.AIOSTREAMS_PASSWORD
			? { username: env.AIOSTREAMS_USERNAME, password: env.AIOSTREAMS_PASSWORD }
			: null;
	return [
		{
			kind: 'aiostreams',
			internalUrl: env.AIOSTREAMS_INTERNAL_URL,
			publicUrl: env.AIOSTREAMS_PUBLIC_URL,
			auth: aiostreamsAuth
		},
		{
			kind: 'aiometadata',
			internalUrl: env.AIOMETADATA_INTERNAL_URL,
			publicUrl: env.AIOMETADATA_PUBLIC_URL,
			auth: {
				adminKey: env.AIOMETADATA_ADMIN_KEY,
				addonPassword: env.AIOMETADATA_ADDON_PASSWORD
			}
		}
	];
}

export async function seedInstances(): Promise<void> {
	for (const d of desired()) {
		const [existing] = await db.select().from(t.instances).where(eq(t.instances.kind, d.kind));
		const rowId = existing?.id ?? crypto.randomUUID();
		const authJsonEnc = d.auth
			? seal(JSON.stringify(d.auth), aadFor('instances', 'auth_json_enc', rowId))
			: null;
		if (existing) {
			await db
				.update(t.instances)
				.set({
					internalUrl: d.internalUrl,
					publicUrl: d.publicUrl,
					authJsonEnc,
					keyVersion: 1,
					updatedAt: new Date()
				})
				.where(eq(t.instances.id, rowId));
		} else {
			await db
				.insert(t.instances)
				.values({
					id: rowId,
					kind: d.kind,
					internalUrl: d.internalUrl,
					publicUrl: d.publicUrl,
					authJsonEnc
				})
				.onConflictDoNothing({ target: t.instances.kind });
		}
	}
	log.info('instances seeded');
}

/** Decrypt an instance row's auth JSON (null when none configured). */
export function openInstanceAuth<T extends InstanceAuth = InstanceAuth>(row: {
	id: string;
	authJsonEnc: string | null;
}): T | null {
	if (!row.authJsonEnc) return null;
	return JSON.parse(open(row.authJsonEnc, aadFor('instances', 'auth_json_enc', row.id))) as T;
}

export async function getInstance(kind: InstanceKind) {
	const [row] = await db.select().from(t.instances).where(eq(t.instances.kind, kind));
	return row ?? null;
}
