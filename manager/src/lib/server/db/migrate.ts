import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env';
import { log } from '../log';

/**
 * Apply pending migrations from `drizzle/` (or MIGRATIONS_DIR). Uses its own
 * single connection and a Postgres advisory lock so two processes starting at
 * once do not race.
 */
export async function runMigrations(databaseUrl: string = env.DATABASE_URL): Promise<void> {
	const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'drizzle');
	const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
	try {
		await sql`select pg_advisory_lock(727274001)`;
		const started = Date.now();
		await migrate(drizzle(sql), { migrationsFolder });
		log.info('migrations applied', { ms: Date.now() - started });
	} finally {
		try {
			await sql`select pg_advisory_unlock(727274001)`;
		} catch {
			// connection gone; lock is released with it
		}
		await sql.end({ timeout: 5 });
	}
}
