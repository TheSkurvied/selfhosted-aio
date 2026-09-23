/**
 * Test helper: fill in a complete, valid env (without overriding values that
 * are already set, except MANAGER_KEY when given) and reset the env cache.
 */
import { resetEnvCache } from './env';

export function useTestEnv(overrides: Record<string, string> = {}): void {
	try {
		process.loadEnvFile('.env');
	} catch {
		// optional
	}
	const defaults: Record<string, string> = {
		DATABASE_URL:
			process.env.TEST_DATABASE_URL ?? 'postgres://manager:manager@localhost:5432/aio_manager_test',
		MANAGER_KEY: 'a'.repeat(64),
		PUBLIC_URL: 'http://localhost:5173',
		AIOSTREAMS_INTERNAL_URL: 'http://localhost:13000',
		AIOSTREAMS_PUBLIC_URL: 'http://localhost:13000',
		AIOMETADATA_INTERNAL_URL: 'http://localhost:13232',
		AIOMETADATA_PUBLIC_URL: 'http://localhost:13232',
		AIOMETADATA_ADMIN_KEY: 'test-admin-key'
	};
	for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
	for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
	resetEnvCache();
}
