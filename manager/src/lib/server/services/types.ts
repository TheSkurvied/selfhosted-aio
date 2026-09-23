import type { InstanceKind } from '../db/schema';
import type { SyncStatus } from './core';

export type { InstanceKind, SyncStatus };
export type { JobRow } from '../jobs/queue';

export type BindingSummary = {
	templateName: string;
	version: number;
	pinned: boolean;
	status: SyncStatus;
};

export type PersonRow = {
	id: string;
	displayName: string;
	tags: string[];
	disabled: boolean;
	notes: string;
	bindings: Record<InstanceKind, BindingSummary | null>;
};

export type BindingDetail = {
	id: string;
	templateId: string;
	templateName: string;
	pinnedVersionId: string | null;
	/** Template's current version number. */
	currentVersion: number;
	/** Version the live config was rendered from (null before the first push). */
	renderedVersion: number | null;
	overrides: object;
	status: SyncStatus;
	lastError?: string;
	account?: {
		id: string;
		remoteUuid: string | null;
		state: string;
		lastPushAt: Date | null;
		lastCheckAt: Date | null;
		createdAt: Date;
	};
	manifestUrl?: string;
	/** Addition: secrets the rendered config still lacks. */
	missingSecrets?: string[];
	/** Addition: version number the binding renders from now (pinned or current). */
	effectiveVersion?: number;
};

export type AuditRow = {
	id: string;
	at: Date;
	actorEmail: string;
	action: string;
	targetType: string | null;
	targetId: string | null;
	summary: string;
	diffPaths: string[];
};

export type ShareTokenRow = {
	id: string;
	createdAt: Date;
	expiresAt: Date | null;
	maxViews: number | null;
	views: number;
	revokedAt: Date | null;
	url?: string;
};

export type PersonDetail = Omit<PersonRow, 'bindings'> & {
	createdAt: Date;
	bindings: Record<InstanceKind, BindingDetail | null>;
	secrets: Array<{ name: string; scope: 'person' | 'shared'; hint: string; updatedAt: Date }>;
	requiredSecrets: Array<{ name: string; satisfiedBy: 'person' | 'shared' | null }>;
	shareTokens: ShareTokenRow[];
	history: AuditRow[];
};
