/**
 * Per-kind body validation. Lenient: it only catches mistakes that upstream is
 * certain to reject (or that would be dangerous to send), and lets everything
 * else through. Placeholder strings count as valid strings.
 */
import { z } from 'zod';
import type { InstanceKind } from '../db/schema';
import { isPlainObject } from './json';

const AIOSTREAMS_FORMATTERS = [
	'gdrive',
	'prism',
	'tamtaro',
	'lightgdrive',
	'minimalisticgdrive',
	'torrentio',
	'torbox',
	'custom'
] as const;

const aiostreamsSchema = z
	.object({
		formatter: z
			.object({ id: z.string().min(1, 'formatter.id is required') })
			.loose()
			.refine((f) => (AIOSTREAMS_FORMATTERS as readonly string[]).includes(f.id), {
				message: `formatter.id must be one of ${AIOSTREAMS_FORMATTERS.join(', ')}`
			}),
		sortCriteria: z.object({ global: z.array(z.unknown()) }).loose(),
		presets: z.array(z.object({}).loose()),
		services: z
			.array(
				z
					.object({
						id: z.string().min(1),
						enabled: z.boolean().optional(),
						credentials: z.record(z.string(), z.unknown()).optional()
					})
					.loose()
			)
			.optional()
	})
	.loose();

const aiometadataSchema = z
	.object({
		language: z.string().optional(),
		apiKeys: z.record(z.string(), z.unknown()).optional(),
		catalogs: z.array(z.unknown()).optional()
	})
	.loose();

function issuesToStrings(issues: z.core.$ZodIssue[]): string[] {
	return issues.map((i) => {
		const p = i.path.map((s) => (typeof s === 'number' ? `[${s}]` : String(s))).join('.');
		return p ? `${p.replace(/\.\[/g, '[')}: ${i.message}` : i.message;
	});
}

export function validateTemplateBody(
	kind: InstanceKind,
	body: unknown
): { ok: boolean; errors: string[] } {
	if (!isPlainObject(body)) return { ok: false, errors: ['body must be a JSON object'] };
	const errors: string[] = [];
	if (kind === 'aiostreams') {
		const r = aiostreamsSchema.safeParse(body);
		if (!r.success) errors.push(...issuesToStrings(r.error.issues));
		else {
			(r.data.services ?? []).forEach((s, i) => {
				if (s.enabled === false) return;
				const creds = s.credentials ?? {};
				const any = Object.values(creds).some((v) => typeof v === 'string' && v.trim() !== '');
				if (!any) errors.push(`services[${i}].credentials: an enabled service needs credentials`);
			});
		}
		for (const k of ['uuid', 'accessKey', 'encryptedPassword']) {
			if (k in body) errors.push(`${k}: must not be set in a template (upstream manages it)`);
		}
		if ('parentConfig' in body && body.parentConfig != null) {
			errors.push('parentConfig: not supported by the manager');
		}
	} else {
		const r = aiometadataSchema.safeParse(body);
		if (!r.success) errors.push(...issuesToStrings(r.error.issues));
		if ('userUUID' in body) errors.push('userUUID: must never be sent to AIOMetadata');
	}
	return { ok: errors.length === 0, errors };
}
