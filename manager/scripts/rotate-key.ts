/**
 * Re-encrypt every sealed column from OLD_MANAGER_KEY to MANAGER_KEY.
 *
 *   OLD_MANAGER_KEY=<old hex> MANAGER_KEY=<new hex> pnpm tsx scripts/rotate-key.ts [--dry-run]
 *
 *   (in the container: docker compose exec -e OLD_MANAGER_KEY=... manager node build/cli/rotate-key.mjs)
 *
 * Runs in one transaction: either every value is re-sealed or nothing changes.
 * Values that already open with the new key are left alone, so it is safe to
 * re-run. Stop the manager first, then restart it with the new MANAGER_KEY.
 * Sessions stay valid; pending login/setup cookies (minutes-long) do not.
 */
import postgres from 'postgres';
import { aadFor, keyFromHex, openWithKey, sealWithKey } from '../src/lib/server/crypto';
import { SEALED_COLUMNS } from '../src/lib/server/db/schema';

async function main() {
	const dryRun = process.argv.includes('--dry-run');
	try {
		process.loadEnvFile('.env');
	} catch {
		// optional
	}
	const oldHex = process.env.OLD_MANAGER_KEY;
	const newHex = process.env.MANAGER_KEY;
	const url = process.env.DATABASE_URL;
	if (!oldHex || !newHex || !url) {
		console.error('Set OLD_MANAGER_KEY, MANAGER_KEY and DATABASE_URL.');
		process.exit(2);
	}
	const oldKey = keyFromHex(oldHex);
	const newKey = keyFromHex(newHex);
	if (oldKey.equals(newKey)) {
		console.error('OLD_MANAGER_KEY and MANAGER_KEY are the same.');
		process.exit(2);
	}

	const sql = postgres(url, { max: 1, onnotice: () => {} });
	let resealed = 0;
	let skipped = 0;
	try {
		await sql.begin(async (tx) => {
			for (const { table, columns } of SEALED_COLUMNS) {
				const rows = await tx.unsafe(
					`select id, ${columns.map((c) => `"${c}"`).join(', ')} from "${table}" for update`
				);
				for (const row of rows) {
					const updates: Record<string, string> = {};
					for (const col of columns) {
						const value = row[col] as string | null;
						if (!value) continue;
						const aad = aadFor(table, col, row.id as string);
						let plain: string;
						try {
							plain = openWithKey(oldKey, value, aad);
						} catch {
							try {
								openWithKey(newKey, value, aad);
								skipped++;
								continue;
							} catch {
								throw new Error(`${table}.${col} row ${row.id} opens with neither key; aborting`);
							}
						}
						updates[col] = sealWithKey(newKey, plain, aad);
					}
					const cols = Object.keys(updates);
					if (cols.length === 0) continue;
					resealed += cols.length;
					if (dryRun) continue;
					const sets = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
					await tx.unsafe(
						`update "${table}" set ${sets}, key_version = key_version + 1 where id = $${cols.length + 1}`,
						[...cols.map((c) => updates[c]), row.id as string]
					);
				}
			}
			if (dryRun) throw new DryRun();
		});
	} catch (err) {
		if (!(err instanceof DryRun)) throw err;
	} finally {
		await sql.end({ timeout: 5 });
	}
	console.log(
		`${dryRun ? '[dry run] would re-seal' : 'Re-sealed'} ${resealed} value(s); ${skipped} already on the new key.`
	);
}

class DryRun extends Error {}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
