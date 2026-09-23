/**
 * Record real upstream exchanges into tests/mocks/fixtures/*.json.
 *
 *   pnpm tsx scripts/upstream/record-fixtures.ts aiometadata [http://localhost:13232]
 *   pnpm tsx scripts/upstream/record-fixtures.ts aiostreams [http://localhost:13000]
 *   pnpm tsx scripts/upstream/record-fixtures.ts aiostreams-auth [http://localhost:13000]
 *
 * Start the service first (scripts/upstream/<service>.sh start, or start-auth for
 * aiostreams-auth). All values in the fixtures are dev values, nothing is scrubbed.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	aiometadataFlow,
	aiostreamsAuthFlow,
	aiostreamsFlow,
	type Flow
} from '../../tests/mocks/flows.ts';
import { runFlow, type FixtureFile } from '../../tests/mocks/runner.ts';

const here = dirname(fileURLToPath(import.meta.url));
const managerDir = join(here, '..', '..');

const targets: Record<string, { flow: Flow; url: string; src: string }> = {
	aiometadata: { flow: aiometadataFlow, url: 'http://localhost:13232', src: 'aiometadata' },
	aiostreams: { flow: aiostreamsFlow, url: 'http://localhost:13000', src: 'AIOStreams' },
	'aiostreams-auth': { flow: aiostreamsAuthFlow, url: 'http://localhost:13000', src: 'AIOStreams' }
};

const which = process.argv[2];
const target = targets[which ?? ''];
if (!target) {
	console.error(`usage: record-fixtures.ts <${Object.keys(targets).join('|')}> [baseUrl]`);
	process.exit(2);
}
const baseUrl = process.argv[3] ?? target.url;

function commitOf(dir: string): string | undefined {
	try {
		return execSync('git rev-parse HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return undefined;
	}
}

const srcDir =
	process.env[which === 'aiometadata' ? 'AIOMETADATA_SRC' : 'AIOSTREAMS_SRC'] ??
	join(managerDir, '.upstream', 'src', target.src);

const exchanges = await runFlow(target.flow, baseUrl);
let mismatches = 0;
for (const x of exchanges) {
	const ok = x.response.status === x.expectStatus;
	if (!ok) mismatches++;
	console.log(
		`${ok ? 'ok  ' : 'DIFF'} ${x.name.padEnd(44)} ${x.response.status} (expected ${x.expectStatus})`
	);
}

const fixture: FixtureFile = {
	service: target.flow.service,
	variant: target.flow.variant,
	recordedAt: new Date().toISOString(),
	upstream: { commit: commitOf(srcDir), baseUrl },
	exchanges
};
const out = join(managerDir, 'tests', 'mocks', 'fixtures', target.flow.fixture);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixture, null, '\t') + '\n');
console.log(`wrote ${out} (${exchanges.length} exchanges, ${mismatches} status mismatches)`);
process.exit(mismatches ? 1 : 0);
