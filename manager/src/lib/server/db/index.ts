/**
 * Lazy Drizzle client. The postgres.js connection is created on first use, so
 * importing this module never needs DATABASE_URL (build, sync, unit tests).
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '../env';

export * as t from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** The type of `tx` inside db.transaction(). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let client: postgres.Sql | null = null;
let instance: Db | null = null;

function getDb(): Db {
	if (!instance) {
		client = postgres(env.DATABASE_URL, {
			max: 10,
			onnotice: () => {}
		});
		instance = drizzle(client, { schema });
	}
	return instance;
}

export const db: Db = new Proxy({} as Db, {
	get(_target, prop) {
		const real = getDb();
		const value = Reflect.get(real, prop, real);
		return typeof value === 'function' ? value.bind(real) : value;
	}
});

/** Close the pool (CLI scripts and tests). A later access reconnects. */
export async function closeDb(): Promise<void> {
	const c = client;
	client = null;
	instance = null;
	if (c) await c.end({ timeout: 5 });
}
