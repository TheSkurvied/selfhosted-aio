// Standalone config for the mock self-test. The root vite.config.ts only
// includes src/**, so run this with:
//   pnpm vitest run --config tests/mocks/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'mocks',
		environment: 'node',
		root: new URL('../..', import.meta.url).pathname,
		include: ['tests/mocks/**/*.spec.ts'],
		testTimeout: 20_000
	}
});
