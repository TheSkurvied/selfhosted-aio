/**
 * Integration test harness (ENGINE). Each test file gets its own database
 * (TEST_DATABASE_URL with a suffix, created on demand) so files can run in
 * parallel; tables are truncated between tests. Upstreams are the node:http
 * mocks from tests/mocks unless a file points env elsewhere.
 */
import postgres from 'postgres';
import { useTestEnv } from '../../src/lib/server/testing';

export const ENGINE_TABLES = [
	'jobs',
	'share_tokens',
	'accounts',
	'secrets',
	'person_bindings',
	'people',
	'template_versions',
	'templates',
	'audit_log',
	'health_samples'
];

export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const ADMIN_EMAIL = 'engine-test@example.com';

/** Returns a database URL for `suffix`, creating the database if needed. */
export async function ensureTestDatabase(suffix: string): Promise<string | null> {
	useTestEnv();
	const base = process.env.TEST_DATABASE_URL;
	if (!base) return null;
	const u = new URL(base);
	const name = `${u.pathname.replace(/^\//, '')}_${suffix}`.replace(/[^a-z0-9_]/gi, '_');
	const admin = postgres(base, { max: 1, onnotice: () => {} });
	try {
		const rows = await admin`select 1 from pg_database where datname = ${name}`;
		if (rows.length === 0) {
			try {
				await admin.unsafe(`create database "${name}"`);
			} catch (e) {
				// a parallel worker may have created it
				if (!/already exists/.test((e as Error).message)) throw e;
			}
		}
	} finally {
		await admin.end({ timeout: 5 });
	}
	u.pathname = '/' + name;
	return u.toString();
}

/** Capture everything written to stdout/stderr (the JSON log lines). */
export function captureOutput() {
	const chunks: string[] = [];
	const out = process.stdout.write.bind(process.stdout);
	const err = process.stderr.write.bind(process.stderr);
	process.stdout.write = ((c: string | Uint8Array, ...rest: unknown[]) => {
		chunks.push(String(c));
		return (out as (...a: unknown[]) => boolean)(c, ...rest);
	}) as typeof process.stdout.write;
	process.stderr.write = ((c: string | Uint8Array, ...rest: unknown[]) => {
		chunks.push(String(c));
		return (err as (...a: unknown[]) => boolean)(c, ...rest);
	}) as typeof process.stderr.write;
	return {
		text: () => chunks.join(''),
		restore() {
			process.stdout.write = out;
			process.stderr.write = err;
		}
	};
}

export type Engine = {
	db: typeof import('../../src/lib/server/db').db;
	t: typeof import('../../src/lib/server/db').t;
	s: typeof import('../../src/lib/server/services');
	jobs: typeof import('../../src/lib/server/jobs');
	core: typeof import('../../src/lib/server/services/core');
	adapters: typeof import('../../src/lib/server/adapters');
	sql: typeof import('drizzle-orm').sql;
	/** Truncate engine tables, re-seed instances, drop cached adapters. */
	reset(): Promise<void>;
	/** Wait for jobs; returns the job rows. */
	wait(
		ids: string[] | string,
		timeoutMs?: number
	): Promise<Array<import('../../src/lib/server/db/schema').Job>>;
	close(): Promise<void>;
};

export async function startEngine(env: Record<string, string>, dbUrl: string): Promise<Engine> {
	useTestEnv({ ...env, DATABASE_URL: dbUrl, CHECK_INTERVAL_HOURS: '0' });
	const { runMigrations } = await import('../../src/lib/server/db/migrate');
	await runMigrations(dbUrl);
	const dbm = await import('../../src/lib/server/db');
	const s = await import('../../src/lib/server/services');
	const jobs = await import('../../src/lib/server/jobs');
	const core = await import('../../src/lib/server/services/core');
	const adapters = await import('../../src/lib/server/adapters');
	const { seedInstances } = await import('../../src/lib/server/instances');
	const { sql } = await import('drizzle-orm');
	const { db, t } = dbm;
	await db.insert(t.admins).values({ id: ADMIN_ID, email: ADMIN_EMAIL }).onConflictDoNothing();
	const e: Engine = {
		db,
		t,
		s,
		jobs,
		core,
		adapters,
		sql,
		async reset() {
			await db.execute(sql.raw(`truncate ${ENGINE_TABLES.join(', ')} restart identity cascade`));
			await seedInstances();
			adapters.resetAdapters();
		},
		async wait(ids, timeoutMs = 30_000) {
			return jobs.waitForJobs(Array.isArray(ids) ? ids : [ids], timeoutMs);
		},
		async close() {
			await jobs.stopJobRunner();
			await dbm.closeDb();
		}
	};
	await e.reset();
	await jobs.startJobRunner({ spacingMs: 20, backoffMs: 100, pollMs: 100 });
	return e;
}

export const AIOSTREAMS_BASE = {
	presets: [],
	formatter: { id: 'gdrive' },
	sortCriteria: { global: [] }
};

export const AIOSTREAMS_RD_TEMPLATE = {
	presets: [],
	formatter: { id: 'gdrive' },
	sortCriteria: { global: [{ key: 'cached', direction: 'desc' }] },
	services: [{ id: 'realdebrid', enabled: true, credentials: { apiKey: '{{secret:rd_key}}' } }]
};

export const AIOMETADATA_TEMPLATE = { language: 'en-US', apiKeys: { tmdb: '{{secret:tmdb_key}}' } };
