/* eslint-disable @typescript-eslint/no-explicit-any -- mocks handle arbitrary upstream JSON */
/**
 * The request sequences the manager performs against each upstream.
 *
 * One definition serves two purposes:
 *  - scripts/upstream/record-fixtures.ts runs a flow against the REAL service and
 *    writes every exchange to tests/mocks/fixtures/<service>[-auth].json;
 *  - tests/mocks/mocks.spec.ts runs the same flow against the MOCK and checks
 *    each status against `expectStatus` and each body against the recorded fixture.
 *
 * `{{name}}` in a path, header or body is replaced with a captured variable.
 */
import { AIOMETADATA_MINIMAL_CONFIG, AIOSTREAMS_MINIMAL_CONFIG } from './configs.ts';

export type Vars = Record<string, string>;

export interface ExchangeResult {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

export interface Step {
	name: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
	path: string;
	headers?: Record<string, string>;
	body?: unknown;
	expectStatus: number;
	/** Pull variables out of the response for later steps. */
	capture?: (res: ExchangeResult, vars: Vars) => void;
	/** Repeat the request until this status is seen (rate-limit probes). */
	repeatUntilStatus?: number;
	maxRepeats?: number;
	note?: string;
}

export interface Flow {
	service: 'aiostreams' | 'aiometadata';
	variant: string;
	/** fixture file name under tests/mocks/fixtures */
	fixture: string;
	initialVars: Vars;
	steps: Step[];
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

function body(res: ExchangeResult): any {
	return res.body as any;
}

export function substitute<T>(value: T, vars: Vars): T {
	if (typeof value === 'string') {
		return value.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m)) as T;
	}
	if (Array.isArray(value)) return value.map((v) => substitute(v, vars)) as T;
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v, vars)])
		) as T;
	}
	return value;
}

/** Cookie pair (name=value) from a set-cookie header value. */
export function cookiePair(setCookie: string | undefined, name: string): string | undefined {
	if (!setCookie) return undefined;
	for (const part of setCookie.split(/,(?=\s*[\w.-]+=)/)) {
		const [pair] = part.trim().split(';');
		if (pair.startsWith(name + '=')) return pair;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// AIOMetadata
// ---------------------------------------------------------------------------

const AMD = { adminKey: 'dev-admin-key', addonPassword: 'dev-addon-password' };

export const aiometadataFlow: Flow = {
	service: 'aiometadata',
	variant: 'default',
	fixture: 'aiometadata.json',
	initialVars: { password: 'person-pass-1', newPassword: 'person-pass-2' },
	steps: [
		{ name: 'health_live', method: 'GET', path: '/health/live', expectStatus: 200 },
		{ name: 'health_ready', method: 'GET', path: '/health/ready', expectStatus: 200 },
		{ name: 'addon_info', method: 'GET', path: '/api/config/addon-info', expectStatus: 200 },
		{
			name: 'save_missing_tmdb_key',
			method: 'POST',
			path: '/api/config/save',
			headers: JSON_HEADERS,
			body: {
				config: { language: 'en-US' },
				password: '{{password}}',
				addonPassword: AMD.addonPassword
			},
			expectStatus: 400
		},
		{
			name: 'save_bad_addon_password',
			method: 'POST',
			path: '/api/config/save',
			headers: JSON_HEADERS,
			body: {
				config: AIOMETADATA_MINIMAL_CONFIG,
				password: '{{password}}',
				addonPassword: 'wrong'
			},
			expectStatus: 401
		},
		{
			name: 'save_missing_password',
			method: 'POST',
			path: '/api/config/save',
			headers: JSON_HEADERS,
			body: { config: AIOMETADATA_MINIMAL_CONFIG, addonPassword: AMD.addonPassword },
			expectStatus: 400
		},
		{
			name: 'save',
			method: 'POST',
			path: '/api/config/save',
			headers: JSON_HEADERS,
			body: {
				config: AIOMETADATA_MINIMAL_CONFIG,
				password: '{{password}}',
				addonPassword: AMD.addonPassword
			},
			expectStatus: 200,
			capture: (res, vars) => {
				vars.uuid = body(res).userUUID;
				vars.uuidPrefix = vars.uuid.slice(0, 8);
			}
		},
		{
			name: 'load',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{password}}', addonPassword: AMD.addonPassword },
			expectStatus: 200
		},
		{
			name: 'load_trusted_without_addon_password',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{password}}' },
			expectStatus: 200,
			note: 'save() trusts the new uuid, so later loads/updates skip the addon password check'
		},
		{
			name: 'load_wrong_password',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: 'nope', addonPassword: AMD.addonPassword },
			expectStatus: 401
		},
		{
			name: 'update',
			method: 'PUT',
			path: '/api/config/update/{{uuid}}',
			headers: JSON_HEADERS,
			body: {
				config: { ...AIOMETADATA_MINIMAL_CONFIG, language: 'fr-FR' },
				password: '{{password}}',
				addonPassword: AMD.addonPassword
			},
			expectStatus: 200
		},
		{
			name: 'update_wrong_password',
			method: 'PUT',
			path: '/api/config/update/{{uuid}}',
			headers: JSON_HEADERS,
			body: {
				config: AIOMETADATA_MINIMAL_CONFIG,
				password: 'nope',
				addonPassword: AMD.addonPassword
			},
			expectStatus: 401
		},
		{
			name: 'update_missing_config',
			method: 'PUT',
			path: '/api/config/update/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{password}}', addonPassword: AMD.addonPassword },
			expectStatus: 400
		},
		{
			name: 'load_after_update',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{password}}', addonPassword: AMD.addonPassword },
			expectStatus: 200
		},
		{ name: 'admin_list_no_key', method: 'GET', path: '/api/admin/users', expectStatus: 401 },
		{
			name: 'admin_list_wrong_key',
			method: 'GET',
			path: '/api/admin/users',
			headers: { 'x-admin-key': 'wrong' },
			expectStatus: 401
		},
		{
			name: 'admin_list',
			method: 'GET',
			path: '/api/admin/users?q=&limit=50&offset=0',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 200
		},
		{
			name: 'admin_list_search_prefix',
			method: 'GET',
			path: '/api/admin/users?q={{uuidPrefix}}&limit=50&offset=0',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 200
		},
		{
			name: 'admin_detail',
			method: 'GET',
			path: '/api/admin/users/{{uuid}}',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 200
		},
		{
			name: 'admin_detail_missing',
			method: 'GET',
			path: '/api/admin/users/00000000-0000-4000-8000-000000000000',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 404
		},
		{
			name: 'admin_reset_password',
			method: 'POST',
			path: '/api/admin/users/{{uuid}}/reset-password',
			headers: { ...JSON_HEADERS, 'x-admin-key': AMD.adminKey },
			body: { newPassword: '{{newPassword}}' },
			expectStatus: 200
		},
		{
			name: 'admin_reset_password_missing',
			method: 'POST',
			path: '/api/admin/users/00000000-0000-4000-8000-000000000000/reset-password',
			headers: { ...JSON_HEADERS, 'x-admin-key': AMD.adminKey },
			body: { newPassword: 'x' },
			expectStatus: 404
		},
		{
			name: 'load_old_password_after_reset',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{password}}', addonPassword: AMD.addonPassword },
			expectStatus: 401
		},
		{
			name: 'load_new_password_after_reset',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{newPassword}}', addonPassword: AMD.addonPassword },
			expectStatus: 200
		},
		{
			name: 'save_overwrite_with_userUUID',
			method: 'POST',
			path: '/api/config/save',
			headers: JSON_HEADERS,
			body: {
				config: { ...AIOMETADATA_MINIMAL_CONFIG, language: 'de-DE' },
				password: '{{newPassword}}',
				addonPassword: AMD.addonPassword,
				userUUID: '{{uuid}}'
			},
			expectStatus: 200,
			note: 'save with userUUID overwrites without checking the old password (spec 7.2)'
		},
		{
			name: 'admin_export',
			method: 'GET',
			path: '/api/admin/users/export',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 200
		},
		{
			name: 'admin_delete',
			method: 'DELETE',
			path: '/api/admin/users/{{uuid}}',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 200
		},
		{
			name: 'admin_delete_again',
			method: 'DELETE',
			path: '/api/admin/users/{{uuid}}',
			headers: { 'x-admin-key': AMD.adminKey },
			expectStatus: 404
		},
		{
			name: 'load_after_delete_without_addon_password',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{newPassword}}' },
			expectStatus: 401,
			note: 'delete removes the trusted_uuids row, so the addon password is required again'
		},
		{
			name: 'load_after_delete',
			method: 'POST',
			path: '/api/config/load/{{uuid}}',
			headers: JSON_HEADERS,
			body: { password: '{{newPassword}}', addonPassword: AMD.addonPassword },
			expectStatus: 401,
			note: 'a missing config is 401 "Invalid UUID or password", never 404'
		},
		{
			name: 'load_rate_limited',
			method: 'POST',
			path: '/api/config/load/00000000-0000-4000-8000-00000000beef',
			headers: JSON_HEADERS,
			body: { password: 'x', addonPassword: AMD.addonPassword },
			expectStatus: 429,
			repeatUntilStatus: 429,
			maxRepeats: 40,
			note: 'CONFIG_LOAD_RATE_LIMIT_PER_MIN (default 20) per uuid per minute bucket'
		}
	]
};

// ---------------------------------------------------------------------------
// AIOStreams (auth not required)
// ---------------------------------------------------------------------------

const AIOS_LOGIN = { username: 'manager', password: 'managerpass' };

function aiostreamsCrudSteps(withSession: boolean): Step[] {
	const cookie: Record<string, string> = withSession ? { cookie: '{{sessionCookie}}' } : {};
	return [
		{
			name: 'create_missing_fields',
			method: 'POST',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG },
			expectStatus: 400
		},
		{
			name: 'create_password_too_short',
			method: 'POST',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG, password: '12345' },
			expectStatus: 400
		},
		{
			name: 'create_invalid_config',
			method: 'POST',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie },
			body: { config: { presets: [] }, password: '{{password}}' },
			expectStatus: 400
		},
		{
			name: 'create',
			method: 'POST',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG, password: '{{password}}' },
			expectStatus: 201,
			capture: (res, vars) => {
				vars.uuid = body(res).data.uuid;
				vars.encryptedPassword = body(res).data.encryptedPassword;
				vars.basic = b64(`${vars.uuid}:${vars.password}`);
				vars.basicWrong = b64(`${vars.uuid}:wrong-password`);
				vars.basicEncrypted = b64(`${vars.uuid}:${vars.encryptedPassword}`);
			}
		},
		{ name: 'exists', method: 'HEAD', path: '/api/v1/user?uuid={{uuid}}', expectStatus: 200 },
		{
			name: 'exists_missing',
			method: 'HEAD',
			path: '/api/v1/user?uuid=00000000-0000-4000-8000-000000000000',
			expectStatus: 400,
			note: 'a missing user is USER_INVALID_DETAILS (400), not 404'
		},
		{ name: 'exists_no_uuid', method: 'HEAD', path: '/api/v1/user', expectStatus: 400 },
		{
			name: 'read_raw',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Basic {{basic}}' },
			expectStatus: 200
		},
		{ name: 'read_no_auth', method: 'GET', path: '/api/v1/user?raw=true', expectStatus: 400 },
		{
			name: 'read_wrong_password',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Basic {{basicWrong}}' },
			expectStatus: 400
		},
		{
			name: 'read_encrypted_password_refused',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Basic {{basicEncrypted}}' },
			expectStatus: 401
		},
		{
			name: 'read_bearer_refused',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Bearer abc' },
			expectStatus: 400
		},
		{
			name: 'update',
			method: 'PUT',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie, authorization: 'Basic {{basic}}' },
			body: { config: { ...AIOSTREAMS_MINIMAL_CONFIG, formatter: { id: 'torrentio' } } },
			expectStatus: 200
		},
		{
			name: 'update_wrong_password',
			method: 'PUT',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie, authorization: 'Basic {{basicWrong}}' },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG },
			expectStatus: 400
		},
		{
			name: 'update_invalid_config',
			method: 'PUT',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, ...cookie, authorization: 'Basic {{basic}}' },
			body: { config: { presets: [] } },
			expectStatus: 400
		},
		{
			name: 'read_after_update',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Basic {{basic}}' },
			expectStatus: 200
		},
		{
			name: 'delete_wrong_password',
			method: 'DELETE',
			path: '/api/v1/user',
			headers: { authorization: 'Basic {{basicWrong}}' },
			expectStatus: 400
		},
		{
			name: 'delete',
			method: 'DELETE',
			path: '/api/v1/user',
			headers: { authorization: 'Basic {{basic}}' },
			expectStatus: 200
		},
		{
			name: 'exists_after_delete',
			method: 'HEAD',
			path: '/api/v1/user?uuid={{uuid}}',
			expectStatus: 400
		},
		{
			name: 'read_after_delete',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Basic {{basic}}' },
			expectStatus: 400
		}
	];
}

const loginSteps: Step[] = [
	{
		name: 'login_wrong_password',
		method: 'POST',
		path: '/api/v1/auth/login',
		headers: JSON_HEADERS,
		body: { username: AIOS_LOGIN.username, password: 'wrong' },
		expectStatus: 401
	},
	{
		name: 'login',
		method: 'POST',
		path: '/api/v1/auth/login',
		headers: JSON_HEADERS,
		body: AIOS_LOGIN,
		expectStatus: 200,
		capture: (res, vars) => {
			vars.sessionCookie = cookiePair(res.headers['set-cookie'], 'aiostreams.session') ?? '';
		}
	},
	{
		name: 'me',
		method: 'GET',
		path: '/api/v1/auth/me',
		headers: { cookie: '{{sessionCookie}}' },
		expectStatus: 200
	},
	{ name: 'me_no_session', method: 'GET', path: '/api/v1/auth/me', expectStatus: 401 }
];

const dashboardSteps: Step[] = [
	{
		name: 'dashboard_users',
		method: 'GET',
		path: '/api/v1/dashboard/users?q=&page=1&limit=25',
		headers: { cookie: '{{sessionCookie}}', accept: 'application/json' },
		expectStatus: 200
	},
	{
		name: 'dashboard_users_no_session',
		method: 'GET',
		path: '/api/v1/dashboard/users',
		headers: { accept: 'application/json' },
		expectStatus: 401
	}
];

export const aiostreamsFlow: Flow = {
	service: 'aiostreams',
	variant: 'default',
	fixture: 'aiostreams.json',
	initialVars: { password: 'person-pass-1' },
	steps: [
		{ name: 'health', method: 'GET', path: '/api/v1/health', expectStatus: 200 },
		{ name: 'status', method: 'GET', path: '/api/v1/status', expectStatus: 200 },
		...aiostreamsCrudSteps(false),
		...loginSteps,
		...dashboardSteps
	]
};

// ---------------------------------------------------------------------------
// AIOStreams with AIOSTREAMS_AUTH_REQUIRED=true
// ---------------------------------------------------------------------------

export const aiostreamsAuthFlow: Flow = {
	service: 'aiostreams',
	variant: 'auth-required',
	fixture: 'aiostreams-auth.json',
	initialVars: { password: 'person-pass-1' },
	steps: [
		{ name: 'health', method: 'GET', path: '/api/v1/health', expectStatus: 200 },
		{
			name: 'create_without_session',
			method: 'POST',
			path: '/api/v1/user',
			headers: JSON_HEADERS,
			body: { config: AIOSTREAMS_MINIMAL_CONFIG, password: '{{password}}' },
			expectStatus: 401,
			note: 'assertConfigAccessKey -> ADDON_PASSWORD_INVALID (401), not UNAUTHORIZED'
		},
		...loginSteps,
		{
			name: 'create_with_session',
			method: 'POST',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, cookie: '{{sessionCookie}}' },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG, password: '{{password}}' },
			expectStatus: 201,
			capture: (res, vars) => {
				vars.uuid = body(res).data.uuid;
				vars.basic = b64(`${vars.uuid}:${vars.password}`);
			}
		},
		{
			name: 'read_raw_without_session',
			method: 'GET',
			path: '/api/v1/user?raw=true',
			headers: { authorization: 'Basic {{basic}}' },
			expectStatus: 200,
			note: 'reads need only Basic auth; accessKey is stripped from userData'
		},
		{
			name: 'update_without_session',
			method: 'PUT',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, authorization: 'Basic {{basic}}' },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG },
			expectStatus: 401
		},
		{
			name: 'update_with_session',
			method: 'PUT',
			path: '/api/v1/user',
			headers: { ...JSON_HEADERS, cookie: '{{sessionCookie}}', authorization: 'Basic {{basic}}' },
			body: { config: AIOSTREAMS_MINIMAL_CONFIG },
			expectStatus: 200
		},
		{
			name: 'delete_without_session',
			method: 'DELETE',
			path: '/api/v1/user',
			headers: { authorization: 'Basic {{basic}}' },
			expectStatus: 200,
			note: 'delete checks only the password'
		}
	]
};

export const allFlows: Flow[] = [aiometadataFlow, aiostreamsFlow, aiostreamsAuthFlow];
