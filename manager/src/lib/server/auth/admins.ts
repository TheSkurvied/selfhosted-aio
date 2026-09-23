import { count } from 'drizzle-orm';
import { db, t } from '../db';

let known = false;

/** True once any admin exists. Positive results are cached (admins are never all removed at runtime). */
export async function hasAdmins(): Promise<boolean> {
	if (known) return true;
	const [row] = await db.select({ n: count() }).from(t.admins);
	known = (row?.n ?? 0) > 0;
	return known;
}

/** Call after creating the first admin (setup) so the cache flips immediately. */
export function markAdminsExist(): void {
	known = true;
}
