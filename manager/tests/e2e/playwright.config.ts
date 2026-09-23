/**
 * End-to-end tests against the dev server and the in-memory upstream mocks.
 *
 *   pnpm exec playwright test -c tests/e2e/playwright.config.ts
 *
 * The web server resets the aio_manager_e2e database on every run (setup starts from zero).
 * Ports: app 5199, AIOStreams mock 23000, AIOMetadata mock 23232.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
	testDir: '.',
	testMatch: '*.e2e.ts',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	outputDir: '../../test-results/e2e',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'retain-on-failure',
		...devices['Desktop Chrome']
	},
	webServer: {
		command: `pnpm tsx scripts/dev-with-mocks.ts --port ${PORT} --streams-port 23000 --metadata-port 23232 --db aio_manager_e2e --fresh`,
		cwd: '../..',
		url: `http://localhost:${PORT}/healthz`,
		reuseExistingServer: false,
		timeout: 120_000,
		stdout: 'ignore',
		stderr: 'pipe'
	}
});
