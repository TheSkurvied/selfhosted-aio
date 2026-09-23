/**
 * Database schema (spec section 6). Enum-like columns are plain text with a
 * TypeScript union via $type<>(). IDs are text UUIDs.
 *
 * Sealed columns (suffix `_enc`) hold seal() output with AAD
 * `${table}.${column}.${rowId}`; every table with sealed columns has
 * `key_version`. Keep SEALED_COLUMNS below in sync: scripts/rotate-key.ts uses it.
 */
import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';

export type InstanceKind = 'aiostreams' | 'aiometadata';
export type SecretScope = 'shared' | 'person';
export type AccountState = 'active' | 'rotating' | 'retired' | 'error';
export type JobType = 'push' | 'check' | 'rotate' | 'import' | 'delete';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export const INSTANCE_KINDS: readonly InstanceKind[] = ['aiostreams', 'aiometadata'];

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tstz('created_at').notNull().defaultNow();
const keyVersion = () => integer('key_version').notNull().default(1);

// ---------------------------------------------------------------- admins / auth

export const admins = pgTable('admins', {
	id: id(),
	/** Stored lowercased. */
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash'),
	totpSecretEnc: text('totp_secret_enc'),
	/** Last accepted TOTP counter (replay guard). */
	totpLastCounter: bigint('totp_last_counter', { mode: 'number' }),
	recoveryCodesHash: text('recovery_codes_hash')
		.array()
		.notNull()
		.default(sql`'{}'::text[]`),
	oidcSub: text('oidc_sub').unique(),
	keyVersion: keyVersion(),
	createdAt: createdAt(),
	lastLoginAt: tstz('last_login_at')
});

export const sessions = pgTable(
	'sessions',
	{
		/** sha256 hex of the cookie token. */
		id: text('id').primaryKey(),
		adminId: text('admin_id')
			.notNull()
			.references(() => admins.id, { onDelete: 'cascade' }),
		createdAt: createdAt(),
		/** Absolute expiry (created + 7 days). Idle expiry is derived from lastSeenAt. */
		expiresAt: tstz('expires_at').notNull(),
		lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
		ip: text('ip'),
		userAgent: text('user_agent')
	},
	(t) => [index('sessions_admin_idx').on(t.adminId), index('sessions_expires_idx').on(t.expiresAt)]
);

export const loginAttempts = pgTable(
	'login_attempts',
	{
		id: id(),
		/** Rate-limit bucket, e.g. `login:${email}|${ip}`. */
		key: text('key').notNull(),
		at: tstz('at').notNull().defaultNow()
	},
	(t) => [index('login_attempts_key_at_idx').on(t.key, t.at)]
);

// ---------------------------------------------------------------- instances

export const instances = pgTable('instances', {
	id: id(),
	kind: text('kind').$type<InstanceKind>().notNull().unique(),
	internalUrl: text('internal_url').notNull(),
	publicUrl: text('public_url').notNull(),
	/** Sealed JSON: {username,password} for aiostreams, {adminKey,addonPassword} for aiometadata. */
	authJsonEnc: text('auth_json_enc'),
	keyVersion: keyVersion(),
	createdAt: createdAt(),
	updatedAt: tstz('updated_at').notNull().defaultNow()
});

// ---------------------------------------------------------------- templates

export const templates = pgTable('templates', {
	id: id(),
	name: text('name').notNull().unique(),
	kind: text('kind').$type<InstanceKind>().notNull(),
	description: text('description').notNull().default(''),
	currentVersionId: text('current_version_id').references((): AnyPgColumn => templateVersions.id, {
		onDelete: 'set null'
	}),
	createdAt: createdAt(),
	updatedAt: tstz('updated_at').notNull().defaultNow()
});

export const templateVersions = pgTable(
	'template_versions',
	{
		id: id(),
		templateId: text('template_id')
			.notNull()
			.references(() => templates.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		bodyJson: jsonb('body_json').$type<Record<string, unknown>>().notNull(),
		requiredSecrets: text('required_secrets')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		note: text('note').notNull().default(''),
		/** Admin id or 'system'. */
		createdBy: text('created_by').notNull(),
		createdAt: createdAt()
	},
	(t) => [unique('template_versions_template_version_uq').on(t.templateId, t.version)]
);

// ---------------------------------------------------------------- people

export const people = pgTable(
	'people',
	{
		id: id(),
		displayName: text('display_name').notNull(),
		notes: text('notes').notNull().default(''),
		tags: text('tags')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		disabled: boolean('disabled').notNull().default(false),
		createdAt: createdAt(),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [index('people_display_name_idx').on(t.displayName)]
);

export const personBindings = pgTable(
	'person_bindings',
	{
		id: id(),
		personId: text('person_id')
			.notNull()
			.references(() => people.id, { onDelete: 'cascade' }),
		instanceId: text('instance_id')
			.notNull()
			.references(() => instances.id, { onDelete: 'restrict' }),
		templateId: text('template_id')
			.notNull()
			.references(() => templates.id, { onDelete: 'restrict' }),
		/** null = follow the template's current version. */
		pinnedVersionId: text('pinned_version_id').references(() => templateVersions.id, {
			onDelete: 'restrict'
		}),
		/** RFC 7386 merge patch applied over the template body. */
		overridesJson: jsonb('overrides_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		createdAt: createdAt(),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [
		unique('person_bindings_person_instance_uq').on(t.personId, t.instanceId),
		index('person_bindings_template_idx').on(t.templateId)
	]
);

export const secrets = pgTable(
	'secrets',
	{
		id: id(),
		scope: text('scope').$type<SecretScope>().notNull(),
		/** Null for shared secrets. */
		personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		valueEnc: text('value_enc').notNull(),
		hint: text('hint').notNull(),
		keyVersion: keyVersion(),
		createdAt: createdAt(),
		updatedAt: tstz('updated_at').notNull().defaultNow()
	},
	(t) => [
		unique('secrets_scope_person_name_uq').on(t.scope, t.personId, t.name).nullsNotDistinct(),
		index('secrets_name_idx').on(t.name)
	]
);

export const accounts = pgTable(
	'accounts',
	{
		id: id(),
		/** Null once the binding is removed but the account row is kept (retired). */
		bindingId: text('binding_id').references(() => personBindings.id, { onDelete: 'set null' }),
		/** Denormalised so retired accounts still know which instance they live on. */
		instanceId: text('instance_id')
			.notNull()
			.references(() => instances.id, { onDelete: 'restrict' }),
		remoteUuid: text('remote_uuid'),
		passwordEnc: text('password_enc'),
		/** AIOStreams encryptedPassword URL segment. */
		manifestSecretEnc: text('manifest_secret_enc'),
		manifestUrlEnc: text('manifest_url_enc'),
		keyVersion: keyVersion(),
		state: text('state').$type<AccountState>().notNull().default('active'),
		desiredHash: text('desired_hash'),
		pushedHash: text('pushed_hash'),
		remoteHash: text('remote_hash'),
		renderedFromVersionId: text('rendered_from_version_id').references(() => templateVersions.id, {
			onDelete: 'set null'
		}),
		lastPushAt: tstz('last_push_at'),
		lastCheckAt: tstz('last_check_at'),
		lastError: text('last_error'),
		createdAt: createdAt(),
		retiredAt: tstz('retired_at')
	},
	(t) => [
		index('accounts_binding_idx').on(t.bindingId),
		index('accounts_instance_remote_idx').on(t.instanceId, t.remoteUuid),
		index('accounts_state_idx').on(t.state)
	]
);

export const shareTokens = pgTable(
	'share_tokens',
	{
		id: id(),
		personId: text('person_id')
			.notNull()
			.references(() => people.id, { onDelete: 'cascade' }),
		/** sha256 hex of the token. */
		tokenHash: text('token_hash').notNull(),
		expiresAt: tstz('expires_at'),
		maxViews: integer('max_views'),
		views: integer('views').notNull().default(0),
		revokedAt: tstz('revoked_at'),
		createdBy: text('created_by'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('share_tokens_hash_uq').on(t.tokenHash),
		index('share_tokens_person_idx').on(t.personId)
	]
);

// ---------------------------------------------------------------- jobs / audit / health

export const jobs = pgTable(
	'jobs',
	{
		id: id(),
		type: text('type').$type<JobType>().notNull(),
		accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
		/** Convenience links for listing; may be null for global jobs. */
		personId: text('person_id').references(() => people.id, { onDelete: 'set null' }),
		kind: text('kind').$type<InstanceKind>(),
		payloadJson: jsonb('payload_json')
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		status: text('status').$type<JobStatus>().notNull().default('queued'),
		attempts: integer('attempts').notNull().default(0),
		runAfter: tstz('run_after').notNull().defaultNow(),
		progress: text('progress'),
		error: text('error'),
		/** Admin id or 'system'. */
		createdBy: text('created_by').notNull().default('system'),
		createdAt: createdAt(),
		startedAt: tstz('started_at'),
		finishedAt: tstz('finished_at')
	},
	(t) => [
		index('jobs_status_run_after_idx').on(t.status, t.runAfter),
		index('jobs_created_idx').on(t.createdAt),
		index('jobs_person_idx').on(t.personId)
	]
);

export const auditLog = pgTable(
	'audit_log',
	{
		id: id(),
		at: tstz('at').notNull().defaultNow(),
		/** Admin id or 'system'. */
		actor: text('actor').notNull(),
		action: text('action').notNull(),
		targetType: text('target_type'),
		targetId: text('target_id'),
		summary: text('summary').notNull(),
		diffPathsJson: jsonb('diff_paths_json')
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		ip: text('ip')
	},
	(t) => [
		index('audit_log_at_idx').on(t.at),
		index('audit_log_target_idx').on(t.targetType, t.targetId),
		index('audit_log_action_idx').on(t.action)
	]
);

export const healthSamples = pgTable(
	'health_samples',
	{
		id: id(),
		instanceId: text('instance_id')
			.notNull()
			.references(() => instances.id, { onDelete: 'cascade' }),
		at: tstz('at').notNull().defaultNow(),
		endpoint: text('endpoint').notNull(),
		ok: boolean('ok').notNull(),
		latencyMs: integer('latency_ms').notNull(),
		bodyExcerpt: text('body_excerpt')
	},
	(t) => [index('health_samples_instance_at_idx').on(t.instanceId, t.at)]
);

// ---------------------------------------------------------------- sealed column registry

/** Every sealed column, by SQL table/column name. AAD is `${table}.${column}.${row.id}`. */
export const SEALED_COLUMNS: ReadonlyArray<{ table: string; columns: readonly string[] }> = [
	{ table: 'admins', columns: ['totp_secret_enc'] },
	{ table: 'instances', columns: ['auth_json_enc'] },
	{ table: 'secrets', columns: ['value_enc'] },
	{ table: 'accounts', columns: ['password_enc', 'manifest_secret_enc', 'manifest_url_enc'] }
];

export type Admin = typeof admins.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Instance = typeof instances.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type Person = typeof people.$inferSelect;
export type PersonBinding = typeof personBindings.$inferSelect;
export type Secret = typeof secrets.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type ShareToken = typeof shareTokens.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type HealthSample = typeof healthSamples.$inferSelect;
