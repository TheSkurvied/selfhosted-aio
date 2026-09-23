import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		await Promise.race([
			db.execute(sql`select 1`),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
		]);
		return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
	} catch {
		return json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
};
