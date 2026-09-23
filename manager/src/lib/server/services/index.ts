/**
 * Engine service API (ARCHITECTURE.md "Engine service API"). Server only.
 * Mutating functions take `actor` (admin id or 'system') and write the audit log.
 */
export { ServiceError } from './errors';
export type { SyncStatus } from './core';
export type {
	AuditRow,
	BindingDetail,
	BindingSummary,
	InstanceKind,
	JobRow,
	PersonDetail,
	PersonRow,
	ShareTokenRow
} from './types';

export { getHealth, getSettings, listJobs, subscribeJobs } from './system';
export {
	listPeople,
	getPerson,
	createPerson,
	updatePerson,
	deletePerson,
	setBinding,
	removeBinding,
	renderPreview,
	diffRemote
} from './people';
export {
	pushBinding,
	checkBinding,
	rotateBinding,
	adoptRemote,
	revokePerson,
	bulk,
	pushAllPending,
	checkAll,
	syncSummary
} from './actions';
export {
	listTemplates,
	getTemplate,
	getTemplateVersion,
	createTemplate,
	updateTemplateMeta,
	deleteTemplate,
	saveTemplateVersion,
	extractSecrets,
	applyExtraction,
	dryRunTemplate,
	pushTemplate,
	validateTemplateBody
} from './templates';
export { listSharedSecrets, setSecret, deleteSecret } from './secrets';
export { createShareToken, revokeShareToken, resolveShareToken } from './share';
export {
	importAiostreams,
	listAiometadataCandidates,
	importAiometadata,
	orphanReport
} from './imports';
export { listAudit } from './audit-list';
export { STARTERS, seedStarterTemplates } from './starters';
