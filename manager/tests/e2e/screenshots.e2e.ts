/**
 * Seeds realistic data through the JSON API and captures the main screens.
 * Skipped unless SCREENSHOTS=1. It must run after manager.e2e.ts, in the same
 * run, because that file creates the admin:
 *
 *   SCREENSHOTS=1 pnpm exec playwright test -c tests/e2e/playwright.config.ts
 *
 * Output: docs/screenshots/pages/*.png
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, open } from './helpers';

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture screenshots');
test.describe.configure({ mode: 'serial' });

const OUT = 'docs/screenshots/pages';

async function call<T = unknown>(
	req: APIRequestContext,
	method: 'GET' | 'POST' | 'PUT',
	path: string,
	data?: unknown
): Promise<T> {
	const res = await req.fetch(path, { method, data });
	expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as T;
}

async function settle(req: APIRequestContext) {
	await expect
		.poll(
			async () => {
				const jobs = await call<Array<{ status: string }>>(req, 'GET', '/api/jobs?limit=200');
				return jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
			},
			{ timeout: 60_000, intervals: [500] }
		)
		.toBe(0);
}

async function shoot(page: Page, name: string, opts: { mobile?: boolean } = {}) {
	// Full-page captures resize the viewport, which would catch the sidebar's
	// width transition mid-animation.
	await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.setViewportSize({ width: 1280, height: 860 });
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${OUT}/${name}-${scheme}-desktop.png`, fullPage: true });
		if (opts.mobile) {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.waitForTimeout(400);
			await page.screenshot({ path: `${OUT}/${name}-${scheme}-mobile.png`, fullPage: true });
		}
	}
	await page.setViewportSize({ width: 1280, height: 860 });
}

let page: Page;
let samId = '';
let familyId = '';
let shareUrl = '';

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
	await login(page);
});

test('seed data', async () => {
	const req = page.request;
	await call(req, 'POST', '/api/templates/starters');
	await call(req, 'PUT', '/api/secrets/shared/tmdb_api_key', { value: 'shared-tmdb-key-7f3a' });

	const family = await call<{ id: string }>(req, 'POST', '/api/templates', {
		name: 'Family',
		kind: 'aiostreams',
		description: 'Real-Debrid, 4K first, English audio.',
		body: {
			presets: [],
			formatter: { id: 'gdrive' },
			sortCriteria: { global: [{ key: 'cached', direction: 'desc' }] },
			services: [{ id: 'realdebrid', enabled: true, credentials: { apiKey: '{{secret:rd_key}}' } }]
		},
		note: 'Initial version'
	});
	familyId = family.id;
	const templates = await call<Array<{ id: string; name: string }>>(req, 'GET', '/api/templates');
	const meta = templates.find((t) => t.name === 'AIOMetadata: TMDB')!;

	const people = [
		{ displayName: 'Sam', tags: ['anime'], key: 'rd-sam-1a2f' },
		{ displayName: 'Uncle Joe', tags: ['family'], key: 'rd-joe-9c0e' },
		{ displayName: 'Alex', tags: ['family', 'tv'], key: 'rd-alex-44b1' },
		{ displayName: 'Old laptop', tags: [], key: null }
	];
	for (const p of people) {
		const { id } = await call<{ id: string }>(req, 'POST', '/api/people', {
			displayName: p.displayName,
			tags: p.tags,
			notes: p.displayName === 'Sam' ? 'Uses the living-room TV and a phone.' : undefined
		});
		if (p.displayName === 'Sam') samId = id;
		await call(req, 'PUT', `/api/people/${id}/bindings/aiometadata`, {
			templateId: meta.id,
			pinnedVersionId: null,
			overrides: {}
		});
		await call(req, 'POST', `/api/people/${id}/bindings/aiometadata/push`);
		if (!p.key) continue;
		await call(req, 'PUT', `/api/secrets/person/${id}/rd_key`, { value: p.key });
		await call(req, 'PUT', `/api/people/${id}/bindings/aiostreams`, {
			templateId: family.id,
			pinnedVersionId: null,
			overrides: p.displayName === 'Sam' ? { formatter: { id: 'torbox' } } : {}
		});
		await call(req, 'POST', `/api/people/${id}/bindings/aiostreams/push`);
	}
	await settle(req);

	// A new template version leaves everyone who follows latest in "Pending".
	await call(req, 'POST', `/api/templates/${family.id}/versions`, {
		body: {
			presets: [],
			formatter: { id: 'gdrive' },
			sortCriteria: {
				global: [
					{ key: 'cached', direction: 'desc' },
					{ key: 'resolution', direction: 'desc' }
				]
			},
			services: [{ id: 'realdebrid', enabled: true, credentials: { apiKey: '{{secret:rd_key}}' } }]
		},
		note: 'Sort by resolution after cache'
	});
	await call(req, 'POST', `/api/people/${samId}/bindings/aiostreams/push`);
	await settle(req);

	const share = await call<{ url: string }>(req, 'POST', `/api/people/${samId}/share-tokens`, {
		expiresInDays: 7
	});
	shareUrl = share.url;
});

test('capture screens', async () => {
	await open(page, '/');
	await shoot(page, 'dashboard', { mobile: true });
	await open(page, '/people');
	await shoot(page, 'people', { mobile: true });
	await open(page, `/people/${samId}`);
	await shoot(page, 'person', { mobile: true });
	await open(page, '/templates');
	await shoot(page, 'templates');
	await open(page, `/templates/${familyId}`);
	await shoot(page, 'template-family');
	for (const path of ['/secrets', '/jobs', '/audit', '/settings']) {
		await open(page, path);
		await shoot(page, path.slice(1));
	}

	const anon = await page.context().browser()!.newPage();
	await anon.goto(new URL(shareUrl).pathname);
	await anon.waitForLoadState('networkidle');
	await shoot(anon, 'share', { mobile: true });
	await anon.close();
});
