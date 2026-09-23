// Bundle the shell CLIs (reset-admin, rotate-key) into build/cli/*.mjs so the
// production image can run them without tsx:  node build/cli/reset-admin.mjs <email>
// esbuild is borrowed from tsx (a devDependency), so no extra dependency.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve('tsx/package.json'))('esbuild');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await esbuild.build({
	entryPoints: ['scripts/reset-admin.ts', 'scripts/rotate-key.ts'],
	outdir: 'build/cli',
	outExtension: { '.js': '.mjs' },
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	external: Object.keys(pkg.dependencies ?? {}),
	banner: {
		js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
	},
	logLevel: 'info'
});
