/**
 * Upstream mocks for vitest.
 *
 *   const mocks = await startMocks();
 *   // point the adapters at mocks.aiostreamsUrl / mocks.aiometadataUrl
 *   mocks.state.aiostreams.faults.inject({ status: 500 });            // next request 500
 *   mocks.state.aiometadata.faults.inject({ hang: true }, { match: { pathPrefix: '/api/config/load' } });
 *   mocks.state.aiostreams.rateLimit.enabled = true;                  // upstream default limits
 *   await mocks.stop();
 *
 * See tests/mocks/README.md for the behaviour each mock reproduces.
 */
import {
	startAiometadataMock,
	type AiometadataMock,
	type AiometadataMockOptions
} from './aiometadata-mock.ts';
import {
	startAiostreamsMock,
	type AiostreamsMock,
	type AiostreamsMockOptions
} from './aiostreams-mock.ts';

export { startAiometadataMock, startAiostreamsMock };
export type { AiometadataMock, AiostreamsMock };
export * from './configs.ts';

export interface StartedMocks {
	aiostreamsUrl: string;
	aiometadataUrl: string;
	aiostreams: AiostreamsMock;
	aiometadata: AiometadataMock;
	state: { aiostreams: AiostreamsMock['state']; aiometadata: AiometadataMock['state'] };
	/** Clear stores, sessions, faults and rate-limit counters on both mocks. */
	reset(): void;
	stop(): Promise<void>;
}

/**
 * Env the manager needs to talk to these mocks (spread into process.env or pass
 * to the env parser). Credentials match the dev values the real scripts use.
 */
export function mockEnv(
	m: Pick<StartedMocks, 'aiostreamsUrl' | 'aiometadataUrl'>
): Record<string, string> {
	return {
		AIOSTREAMS_INTERNAL_URL: m.aiostreamsUrl,
		AIOSTREAMS_PUBLIC_URL: m.aiostreamsUrl,
		AIOSTREAMS_USERNAME: 'manager',
		AIOSTREAMS_PASSWORD: 'managerpass',
		AIOMETADATA_INTERNAL_URL: m.aiometadataUrl,
		AIOMETADATA_PUBLIC_URL: m.aiometadataUrl,
		AIOMETADATA_ADMIN_KEY: 'dev-admin-key',
		AIOMETADATA_ADDON_PASSWORD: 'dev-addon-password'
	};
}

export async function startMocks(
	opts: { aiostreams?: AiostreamsMockOptions; aiometadata?: AiometadataMockOptions } = {}
): Promise<StartedMocks> {
	const [aiostreams, aiometadata] = await Promise.all([
		startAiostreamsMock(opts.aiostreams),
		startAiometadataMock(opts.aiometadata)
	]);
	return {
		aiostreamsUrl: aiostreams.url,
		aiometadataUrl: aiometadata.url,
		aiostreams,
		aiometadata,
		state: { aiostreams: aiostreams.state, aiometadata: aiometadata.state },
		reset() {
			aiostreams.reset();
			aiometadata.reset();
		},
		async stop() {
			await Promise.all([aiostreams.stop(), aiometadata.stop()]);
		}
	};
}
