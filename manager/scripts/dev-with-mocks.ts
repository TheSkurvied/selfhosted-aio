/**
 * Run the manager in dev mode against the in-memory upstream mocks.
 *
 *   pnpm tsx scripts/dev-with-mocks.ts                 # mocks on 13000/13232, app on 5173
 *   pnpm tsx scripts/dev-with-mocks.ts --mocks-only    # just the mocks, until Ctrl+C
 *   pnpm tsx scripts/dev-with-mocks.ts --port 5174 --streams-port 23000 --metadata-port 23232 \
 *       --db aio_manager_e2e --fresh                   # what the e2e tests use
 *
 * --db NAME swaps the database name in DATABASE_URL (from .env) and creates it if missing.
 * --fresh drops everything in that database first; it refuses unless NAME ends in "_e2e".
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { mockEnv, startMocks } from '../tests/mocks/index.ts';

const args = process.argv.slice(2);
function opt(name: string, fallback?: string): string | undefined {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const flag = (name: string) => args.includes(`--${name}`);

const root = resolve(import.meta.dirname, '..');
const streamsPort = Number(opt('streams-port', '13000'));
const metadataPort = Number(opt('metadata-port', '13232'));
const appPort = Number(opt('port', '5173'));
const dbName = opt('db');

function readDotEnv(): Record<string, string> {
	const file = resolve(root, '.env');
	if (!existsSync(file)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
		if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
	return out;
}

async function prepareDb(baseUrl: string): Promise<string> {
	if (!dbName) return baseUrl;
	if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error('--db must be a plain database name');
	const url = new URL(baseUrl);
	const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
	try {
		const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
		if (!exists.length) await admin.unsafe(`create database "${dbName}"`);
	} finally {
		await admin.end();
	}
	url.pathname = `/${dbName}`;
	if (flag('fresh')) {
		if (!dbName.endsWith('_e2e')) throw new Error('--fresh only works on databases named *_e2e');
		const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
		try {
			await sql.unsafe('drop schema if exists drizzle cascade');
			await sql.unsafe('drop schema if exists public cascade');
			await sql.unsafe('create schema public');
		} finally {
			await sql.end();
		}
		console.log(`[dev-with-mocks] reset database ${dbName}`);
	}
	return url.toString();
}

const mocks = await startMocks({
	aiostreams: { port: streamsPort, accounts: { manager: 'managerpass' } },
	aiometadata: { port: metadataPort }
});
console.log(`[dev-with-mocks] AIOStreams mock  ${mocks.aiostreamsUrl}`);
console.log(`[dev-with-mocks] AIOMetadata mock ${mocks.aiometadataUrl}`);

let child: ReturnType<typeof spawn> | null = null;
async function shutdown(code = 0) {
	child?.kill('SIGTERM');
	await mocks.stop().catch(() => {});
	process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

if (flag('mocks-only')) {
	console.log('[dev-with-mocks] mocks only; Ctrl+C to stop');
} else {
	const dotenv = readDotEnv();
	const databaseUrl = await prepareDb(process.env.DATABASE_URL ?? dotenv.DATABASE_URL);
	const publicUrl = `http://localhost:${appPort}`;
	const env = {
		...process.env,
		...dotenv,
		...mockEnv(mocks),
		DATABASE_URL: databaseUrl,
		PUBLIC_URL: publicUrl,
		ORIGIN: publicUrl
	};
	child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', String(appPort), '--strictPort'], {
		cwd: root,
		env,
		stdio: 'inherit'
	});
	child.on('exit', (code) => void shutdown(code ?? 0));
}
