/**
 * Runtime configuration, validated with zod.
 *
 * Evaluation is lazy: nothing is read until a property of `env` is first
 * accessed, so `svelte-kit sync`, `vite build` and unit tests that never touch
 * the config do not need any variables set.
 *
 * Plain `process.env` is used instead of `$env/dynamic/private` so the same
 * module works from tsx CLI scripts (scripts/*.ts) and drizzle tooling. Outside
 * production a local `.env` file is loaded (without overriding real env vars),
 * which mirrors what `vite dev` does for `$env`.
 */
import { z } from 'zod';

const optionalString = z
	.string()
	.optional()
	.transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const url = z.string().trim().url();

const schema = z.object({
	DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
	MANAGER_KEY: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{64}$/, 'MANAGER_KEY must be 64 hex characters (openssl rand -hex 32)'),
	PORT: z.coerce.number().int().positive().default(8080),
	PUBLIC_URL: url.transform((v) => v.replace(/\/+$/, '')),
	AIOSTREAMS_INTERNAL_URL: url.transform((v) => v.replace(/\/+$/, '')),
	AIOSTREAMS_PUBLIC_URL: url.transform((v) => v.replace(/\/+$/, '')),
	AIOSTREAMS_USERNAME: optionalString,
	AIOSTREAMS_PASSWORD: optionalString,
	AIOMETADATA_INTERNAL_URL: url.transform((v) => v.replace(/\/+$/, '')),
	AIOMETADATA_PUBLIC_URL: url.transform((v) => v.replace(/\/+$/, '')),
	AIOMETADATA_ADMIN_KEY: z.string().trim().min(1, 'AIOMETADATA_ADMIN_KEY is required'),
	AIOMETADATA_ADDON_PASSWORD: optionalString,
	OIDC_ISSUER: optionalString,
	OIDC_CLIENT_ID: optionalString,
	OIDC_CLIENT_SECRET: optionalString,
	ADMIN_EMAILS: optionalString,
	NTFY_URL: optionalString,
	CHECK_INTERVAL_HOURS: z.coerce.number().min(0).default(6),
	LOG_LEVEL: z
		.string()
		.optional()
		.transform((v) => (v ?? 'info').toLowerCase())
		.pipe(z.enum(['debug', 'info', 'warn', 'error']))
});

type Parsed = z.output<typeof schema>;

export type Env = Parsed & {
	/** True when OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and ADMIN_EMAILS are all set. */
	oidcEnabled: boolean;
	/** ADMIN_EMAILS split on commas, trimmed and lowercased. */
	adminEmails: string[];
	/** True when PUBLIC_URL is https (controls the Secure cookie flag). */
	secureCookies: boolean;
};

let cached: Env | null = null;
let dotenvTried = false;

function loadDotenv() {
	if (dotenvTried) return;
	dotenvTried = true;
	if (process.env.NODE_ENV === 'production') return;
	try {
		process.loadEnvFile('.env');
	} catch {
		// no .env file: fine
	}
}

/** Parse and validate the environment. Throws a readable error listing every problem. */
export function loadEnv(): Env {
	if (cached) return cached;
	loadDotenv();
	const result = schema.safeParse(process.env);
	if (!result.success) {
		const problems = result.error.issues
			.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
			.join('\n');
		throw new Error(`Invalid manager configuration:\n${problems}`);
	}
	const p = result.data;
	const adminEmails = (p.ADMIN_EMAILS ?? '')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	cached = {
		...p,
		MANAGER_KEY: p.MANAGER_KEY.toLowerCase(),
		adminEmails,
		oidcEnabled: Boolean(
			p.OIDC_ISSUER && p.OIDC_CLIENT_ID && p.OIDC_CLIENT_SECRET && adminEmails.length > 0
		),
		secureCookies: p.PUBLIC_URL.startsWith('https://')
	};
	return cached;
}

/** Test helper: forget the cached config so the next access re-reads process.env. */
export function resetEnvCache() {
	cached = null;
}

/** Lazily validated config. The first property access parses process.env. */
export const env: Env = new Proxy({} as Env, {
	get(_target, prop) {
		return Reflect.get(loadEnv(), prop);
	},
	has(_target, prop) {
		return prop in loadEnv();
	},
	ownKeys() {
		return Reflect.ownKeys(loadEnv());
	},
	getOwnPropertyDescriptor(_target, prop) {
		const d = Reflect.getOwnPropertyDescriptor(loadEnv(), prop);
		if (d) d.configurable = true;
		return d;
	}
});
