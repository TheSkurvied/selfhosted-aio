/**
 * Smallest configs each upstream accepts without any network access.
 * These double as seed template bodies for tests and as starter templates.
 * See tests/mocks/README.md for how they were derived.
 */

/**
 * AIOStreams: `UserDataSchema` (packages/core/src/db/schemas.ts:739) requires only
 * `formatter` (`{ id }`, one of gdrive|prism|tamtaro|lightgdrive|minimalisticgdrive|
 * torrentio|torbox|custom), `sortCriteria.global` (an array; it may be empty) and
 * `presets` (an array; it may be empty). With zero presets `validateConfig`
 * (core/src/utils/config.ts:139) fetches no addon manifests, so create and
 * update work offline.
 *
 * What upstream stores differs from what you send (see README, "normalization"):
 * zod strips unknown keys and adds `checkOwned: true` and `proxy: {}`. A read
 * also adds `uuid` and `trusted`.
 */
export const AIOSTREAMS_MINIMAL_CONFIG = {
	presets: [],
	formatter: { id: 'gdrive' },
	sortCriteria: { global: [] }
} as const;

/**
 * A starter that carries a debrid key, which is the usual per-person secret.
 * `validateService` only checks credential types (it makes no network call), and
 * no preset means no addon fetch. The credential is shown as a manager secret
 * placeholder. NOT verified against a real instance (the AIOStreams build was
 * blocked in the sandbox); the minimal config above is derived from the same source.
 */
export const AIOSTREAMS_STARTER_CONFIG = {
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
		{ id: 'realdebrid', enabled: true, credentials: { apiKey: '{{secret.REALDEBRID_API_KEY}}' } }
	]
} as const;

/**
 * AIOMetadata: the only save-time check that can fail for a plain config is
 * `validateRequiredKeys` (addon/lib/configApi.js:118): `apiKeys.tmdb` must be a
 * non-empty string unless the server has BUILT_IN_TMDB_API_KEY. The key is not
 * checked against TMDB on save. Verified against the real service: save, load,
 * update and the manifest all work with this body.
 *
 * Upstream adds `lastModified`, `configVersion` and `configHash` on every save.
 */
export const AIOMETADATA_MINIMAL_CONFIG = {
	language: 'en-US',
	apiKeys: { tmdb: 'dev-tmdb-key' }
} as const;

/** Keys each upstream adds or rewrites on its own. Drift checks must ignore them. */
export const AIOSTREAMS_NORMALIZED_KEYS = [
	'uuid',
	'trusted',
	'ip',
	'accessKey',
	'activeVariants',
	'autoVariants',
	'healthResults',
	'variantSelectorLocation',
	'encryptedPassword'
] as const;

export const AIOMETADATA_NORMALIZED_KEYS = ['lastModified', 'configVersion', 'configHash'] as const;

/**
 * Top-level defaults AIOStreams writes into a stored config when the body leaves
 * them out: `checkOwned` is `z.boolean().optional().default(true)`
 * (schemas.ts:1149) and `proxy` is always reassigned by `validateProxy`
 * (config.ts:438, returns `{}` when no proxy is set). A drift check should
 * either include these in the template or treat them as equal when absent.
 */
export const AIOSTREAMS_DEFAULTED_FIELDS = { checkOwned: true, proxy: {} } as const;
