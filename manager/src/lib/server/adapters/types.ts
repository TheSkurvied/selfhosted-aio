import type { InstanceKind } from '../db/schema';

export type Config = Record<string, unknown>;

export type CreateResult = {
	uuid: string;
	/** Raw upstream password (manager generated). */
	password: string;
	manifestUrl: string;
	/** AIOStreams encryptedPassword URL segment. */
	manifestSecret?: string;
};

export type HealthCheck = { endpoint: string; ok: boolean; latencyMs: number; detail?: string };
export type HealthResult = { ok: boolean; version?: string; checks: HealthCheck[] };

export type RemoteUser = { uuid: string; createdAt?: string; lastUpdated?: string };

/** The interface both services share (spec section 7). */
export interface UpstreamAdapter {
	readonly kind: InstanceKind;
	readonly publicUrl: string;
	create(config: Config): Promise<CreateResult>;
	read(uuid: string, password: string): Promise<Config>;
	update(uuid: string, password: string, config: Config): Promise<void>;
	/** Idempotent: a config that is already gone counts as deleted. */
	delete(uuid: string, password?: string | null): Promise<void>;
	health(): Promise<HealthResult>;
	manifestUrl(uuid: string, manifestSecret?: string | null): string;
	/** Every config upstream (admin listing), for the orphan report and imports. */
	listRemote(): Promise<RemoteUser[]>;
}
