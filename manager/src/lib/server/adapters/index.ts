/**
 * Adapter registry. Adapters are built from env (the instances table mirrors
 * env) and cached, so the AIOStreams session cookie survives between jobs.
 * The cache key includes the config, so tests that change env get fresh ones.
 */
import type { InstanceKind } from '../db/schema';
import { env } from '../env';
import { AiometadataAdapter } from './aiometadata';
import { AiostreamsAdapter } from './aiostreams';
import { parseRateSpec } from './http';

export * from './http';
export * from './types';
export { AiostreamsAdapter, AiometadataAdapter };

let cache: { key: string; aiostreams: AiostreamsAdapter; aiometadata: AiometadataAdapter } | null = null;

function build() {
	const key = [
		env.AIOSTREAMS_INTERNAL_URL,
		env.AIOSTREAMS_PUBLIC_URL,
		env.AIOSTREAMS_USERNAME ?? '',
		env.AIOSTREAMS_PASSWORD ?? '',
		env.AIOMETADATA_INTERNAL_URL,
		env.AIOMETADATA_PUBLIC_URL,
		env.AIOMETADATA_ADMIN_KEY,
		env.AIOMETADATA_ADDON_PASSWORD ?? '',
		process.env.AIOSTREAMS_USER_API_LIMIT ?? ''
	].join('\u0000');
	if (cache?.key === key) return cache;
	cache = {
		key,
		aiostreams: new AiostreamsAdapter({
			internalUrl: env.AIOSTREAMS_INTERNAL_URL,
			publicUrl: env.AIOSTREAMS_PUBLIC_URL,
			username: env.AIOSTREAMS_USERNAME,
			password: env.AIOSTREAMS_PASSWORD,
			// Optional override "max/windowSeconds" (default 5/5, the upstream
			// default). Raise it together with USER_API_RATE_LIMIT_MAX_REQUESTS.
			userApiLimit: parseRateSpec(process.env.AIOSTREAMS_USER_API_LIMIT, { max: 5, windowMs: 5000 })
		}),
		aiometadata: new AiometadataAdapter({
			internalUrl: env.AIOMETADATA_INTERNAL_URL,
			publicUrl: env.AIOMETADATA_PUBLIC_URL,
			adminKey: env.AIOMETADATA_ADMIN_KEY,
			addonPassword: env.AIOMETADATA_ADDON_PASSWORD
		})
	};
	return cache;
}

export function aiostreams(): AiostreamsAdapter {
	return build().aiostreams;
}

export function aiometadata(): AiometadataAdapter {
	return build().aiometadata;
}

export function getAdapter(kind: InstanceKind): AiostreamsAdapter | AiometadataAdapter {
	return kind === 'aiostreams' ? aiostreams() : aiometadata();
}

/** Test helper: drop cached adapters (and their cookies). */
export function resetAdapters(): void {
	cache = null;
}
