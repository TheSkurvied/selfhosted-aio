import { expect, test, type Page } from '@playwright/test';
import { login, open, setupAdmin } from './helpers';

// One admin, one database, one signed-in page: the steps build on each other.
test.describe.configure({ mode: 'serial' });

let page: Page;
let shareUrl = '';
let personPath = '';

test.beforeAll(async ({ browser }) => {
	page = await browser.newPage();
});
test.afterAll(async () => {
	await page.close();
});

test('first-run setup creates an admin and signs in', async () => {
	await setupAdmin(page);
	await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
	// Setup is closed once an admin exists: no account form any more.
	await page.goto('/setup');
	await expect(page.getByText('Setup is complete')).toBeVisible();
	await expect(page.locator('input[name="password2"]')).toHaveCount(0);
});

test('sign out, then log in with password and TOTP', async () => {
	await open(page, '/');
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.waitForURL('**/login');
	await login(page);
});

test('create a person from the People page', async () => {
	// Templates to bind later.
	await open(page, '/templates');
	await page.getByRole('button', { name: 'Add starter templates' }).click();
	await expect(page.getByRole('link', { name: /AIOStreams: minimal/ })).toBeVisible();

	await open(page, '/people');
	await expect(page.getByText('No people yet')).toBeVisible();
	await page.getByRole('button', { name: 'New person' }).first().click();
	const dialog = page.getByRole('dialog', { name: 'New person' });
	await dialog.getByLabel('Name').fill('Grandma');
	await dialog.getByLabel('Tags').fill('family');
	await dialog.getByLabel('Tags').press('Enter');
	await dialog.getByRole('button', { name: 'Create person' }).click();
	await expect(page.getByRole('heading', { name: 'Grandma', level: 1 })).toBeVisible();
	personPath = new URL(page.url()).pathname;

	await open(page, '/people');
	await expect(page.getByRole('link', { name: /Grandma/ })).toBeVisible();
});

test('bind a template, then push it to AIOStreams', async () => {
	await open(page, personPath);
	const streams = page.locator('#binding-aiostreams');
	await streams.getByLabel('AIOStreams template').selectOption({ label: 'AIOStreams: minimal' });
	await streams.getByRole('button', { name: 'Bind template' }).click();
	await expect(streams.getByText('Overrides (JSON merge patch)')).toBeVisible();
	await expect(streams.getByText('Never pushed')).toBeVisible();

	await streams.getByRole('button', { name: 'Push', exact: true }).click();
	await expect(page.getByText('Push to AIOStreams queued')).toBeVisible();
	// The job runs in the background; the page refreshes itself when it finishes.
	await expect(streams.getByText('In sync')).toBeVisible({ timeout: 30_000 });
	await expect(streams.getByText('Manifest URL')).toBeVisible();
});

test('create a share link and open the public share page', async ({ browser }) => {
	await open(page, personPath);
	const share = page.locator('#share');
	await share.getByRole('button', { name: 'Create link' }).click();
	const url = share.locator('.new-url code');
	await expect(url).toBeVisible();
	shareUrl = ((await url.textContent()) ?? '').trim();
	expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/);

	// A fresh, signed-out browser context.
	const anon = await browser.newContext();
	const pub = await anon.newPage();
	await pub.goto(new URL(shareUrl).pathname);
	await expect(pub.getByRole('heading', { name: 'Stremio setup for Grandma' })).toBeVisible();
	await expect(pub.getByRole('link', { name: 'Install in Stremio' })).toHaveAttribute(
		'href',
		/^stremio:\/\//
	);
	await expect(pub.getByRole('button', { name: 'Copy manifest URL' })).toBeVisible();
	await expect(pub.getByRole('navigation')).toHaveCount(0);

	const bad = await pub.goto('/s/not-a-real-token-000000000000000');
	expect(bad?.status()).toBe(404);
	await expect(
		pub.getByRole('heading', { name: 'This link has expired or is not valid' })
	).toBeVisible();
	await anon.close();
});

test('revoking the share link turns the page into the expired page', async ({ browser }) => {
	await open(page, personPath);
	await page.locator('#share').getByRole('button', { name: 'Revoke' }).first().click();
	await expect(page.getByText('Share link revoked')).toBeVisible();

	const anon = await browser.newContext();
	const pub = await anon.newPage();
	const res = await pub.goto(new URL(shareUrl).pathname);
	expect(res?.status()).toBe(404);
	await expect(
		pub.getByRole('heading', { name: 'This link has expired or is not valid' })
	).toBeVisible();
	await anon.close();
});
