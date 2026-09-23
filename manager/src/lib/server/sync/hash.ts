import { canonicalJson, sha256Hex } from '../crypto';
import type { InstanceKind } from '../db/schema';
import { strip } from './strip';

/** sha256 of the canonical JSON of the stripped config. */
export function configHash(kind: InstanceKind, config: unknown): string {
	return sha256Hex(canonicalJson(strip(kind, config)));
}
