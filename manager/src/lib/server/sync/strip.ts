/**
 * strip(): remove the fields an upstream fills in or rewrites on its own, so a
 * config we send and the config we read back hash the same.
 *
 * AIOStreams (users.ts:86-91, 369-374; read adds uuid/trusted; accessKey is
 * injected under AUTH_REQUIRED and removed on read). It also writes defaults:
 * `checkOwned: true` (schemas.ts:1149) and `proxy: {}` (config.ts:438); those
 * are dropped when they hold the default so "absent" and "default" compare equal.
 *
 * AIOMetadata (configApi.js:335-352, database.ts:556-563): lastModified,
 * configVersion, configHash. `userUUID` must never be sent, so it is stripped too.
 *
 * Keys are sorted later by canonicalJson().
 */
import type { InstanceKind } from '../db/schema';
import { clone, isPlainObject } from './json';

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

export const AIOMETADATA_NORMALIZED_KEYS = [
	'lastModified',
	'configVersion',
	'configHash',
	'userUUID'
] as const;

export function strip(kind: InstanceKind, config: unknown): Record<string, unknown> {
	if (!isPlainObject(config)) return {};
	const out = clone(config);
	if (kind === 'aiostreams') {
		for (const k of AIOSTREAMS_NORMALIZED_KEYS) delete out[k];
		if (out.checkOwned === true) delete out.checkOwned;
		if (isPlainObject(out.proxy) && Object.keys(out.proxy).length === 0) delete out.proxy;
	} else {
		for (const k of AIOMETADATA_NORMALIZED_KEYS) delete out[k];
		// the load endpoint rewrites apiKeys.customDescriptionBlurb to undefined
		if (isPlainObject(out.apiKeys)) delete out.apiKeys.customDescriptionBlurb;
	}
	return dropUndefined(out) as Record<string, unknown>;
}

function dropUndefined(v: unknown): unknown {
	if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : dropUndefined(x)));
	if (isPlainObject(v)) {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = dropUndefined(x);
		return out;
	}
	return v;
}

/** What is sent upstream: the rendered config minus fields we must never send. */
export function outgoing(
	kind: InstanceKind,
	config: Record<string, unknown>
): Record<string, unknown> {
	const out = clone(config);
	if (kind === 'aiostreams') {
		for (const k of ['uuid', 'accessKey', 'encryptedPassword', 'trusted']) delete out[k];
	} else {
		delete out.userUUID;
	}
	return out;
}
