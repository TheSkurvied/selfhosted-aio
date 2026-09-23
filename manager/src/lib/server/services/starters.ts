/**
 * Starter templates: the smallest bodies each upstream accepts (see
 * tests/mocks/README.md section 2), plus variants with the usual per-person
 * secret as a placeholder. seedStarterTemplates() is called from the
 * Settings/Templates page on demand; it never runs automatically.
 */
import { eq } from 'drizzle-orm';
import { db, t } from '../db';
import type { InstanceKind } from '../db/schema';
import { createTemplate } from './templates';

export type Starter = {
	name: string;
	kind: InstanceKind;
	description: string;
	body: Record<string, unknown>;
};

/** AIOStreams: formatter, sortCriteria.global and presets are the only required fields. */
export const AIOSTREAMS_MINIMAL: Record<string, unknown> = {
	presets: [],
	formatter: { id: 'gdrive' },
	sortCriteria: { global: [] }
};

/** AIOMetadata: apiKeys.tmdb is required unless the server has BUILT_IN_TMDB_API_KEY. */
export const AIOMETADATA_MINIMAL: Record<string, unknown> = {
	language: 'en-US',
	apiKeys: { tmdb: '{{secret:tmdb_api_key}}' }
};

export const STARTERS: readonly Starter[] = [
	{
		name: 'AIOStreams: minimal',
		kind: 'aiostreams',
		description: 'Smallest valid AIOStreams config: no addons, no debrid service.',
		body: AIOSTREAMS_MINIMAL
	},
	{
		name: 'AIOStreams: Real-Debrid',
		kind: 'aiostreams',
		description:
			'Real-Debrid enabled with a per-person (or shared) key. Add presets in the editor.',
		body: {
			presets: [],
			formatter: { id: 'gdrive' },
			sortCriteria: {
				global: [
					{ key: 'cached', direction: 'desc' },
					{ key: 'resolution', direction: 'desc' },
					{ key: 'quality', direction: 'desc' }
				]
			},
			services: [
				{
					id: 'realdebrid',
					enabled: true,
					credentials: { apiKey: '{{secret:realdebrid_api_key}}' }
				}
			]
		}
	},
	{
		name: 'AIOMetadata: TMDB',
		kind: 'aiometadata',
		description: 'Minimal AIOMetadata config using a TMDB API key (usually a shared secret).',
		body: AIOMETADATA_MINIMAL
	}
];

/** Create any starter template whose name is not taken yet. */
export async function seedStarterTemplates(actor: string): Promise<{ created: string[] }> {
	const created: string[] = [];
	for (const s of STARTERS) {
		const [dup] = await db
			.select({ id: t.templates.id })
			.from(t.templates)
			.where(eq(t.templates.name, s.name));
		if (dup) continue;
		await createTemplate(actor, {
			name: s.name,
			kind: s.kind,
			description: s.description,
			body: s.body,
			note: 'Starter template'
		});
		created.push(s.name);
	}
	return { created };
}
