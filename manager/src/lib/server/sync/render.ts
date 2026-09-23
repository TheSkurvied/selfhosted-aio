/**
 * Render (spec section 8): template body -> merge overrides -> substitute
 * secrets -> validate -> hash. Pure: secrets are passed in as a lookup.
 */
import type { InstanceKind } from '../db/schema';
import { configHash } from './hash';
import { isPlainObject } from './json';
import { applyMergePatch } from './merge-patch';
import { substitutePlaceholders } from './placeholders';
import { validateTemplateBody } from './validate';

export type RenderInput = {
	kind: InstanceKind;
	base: Record<string, unknown>;
	overrides: Record<string, unknown>;
	lookup: (name: string) => string | undefined;
};

export type RenderResult = {
	/** Resolved config (contains secret values; keep in memory only). */
	resolved: Record<string, unknown>;
	/** Merged config with placeholders intact (safe to show). */
	merged: Record<string, unknown>;
	missingSecrets: string[];
	errors: string[];
	desiredHash: string;
};

export function render(input: RenderInput): RenderResult {
	const merged = applyMergePatch(input.base, input.overrides);
	const mergedObj = isPlainObject(merged) ? merged : {};
	const { value, missing } = substitutePlaceholders(mergedObj, input.lookup);
	const resolved = value as Record<string, unknown>;
	const { errors } = validateTemplateBody(input.kind, resolved);
	return {
		resolved,
		merged: mergedObj,
		missingSecrets: missing,
		errors,
		desiredHash: configHash(input.kind, resolved)
	};
}
