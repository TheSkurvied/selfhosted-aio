import { expect, type Page } from '@playwright/test';
import { decodeBase32IgnorePadding } from '@oslojs/encoding';
import { generateTOTP } from '@oslojs/otp';

export const ADMIN = { email: 'admin@example.com', password: 'correct horse battery staple 42' };

let totpSecret: string | null = null;
let lastCounter = -1;

/** A fresh TOTP code; waits for the next 30 s window if the current one was already used. */
export async function totp(secret = totpSecret): Promise<string> {
	if (!secret) throw new Error('TOTP secret unknown: run setup first');
	let counter = Math.floor(Date.now() / 30_000);
	if (counter <= lastCounter) {
		await new Promise((r) => setTimeout(r, (counter + 1) * 30_000 - Date.now() + 250));
		counter = Math.floor(Date.now() / 30_000);
	}
	lastCounter = counter;
	return generateTOTP(decodeBase32IgnorePadding(secret.replace(/\s+/g, '')), 30, 6);
}

/** Runs the first-admin setup flow and leaves the page on the dashboard, signed in. */
export async function setupAdmin(page: Page) {
	await page.goto('/setup');
	await page.getByLabel('Email').fill(ADMIN.email);
	await page.locator('input[name="password"]').fill(ADMIN.password);
	await page.locator('input[name="password2"]').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.getByText("Can't scan? Enter the key manually").click();
	const key = page.locator('.secret-text');
	await expect(key).toBeVisible();
	totpSecret = ((await key.textContent()) ?? '').replace(/\s+/g, '');
	await page.getByLabel('Authentication code').fill(await totp());
	await page.getByRole('button', { name: 'Verify and finish' }).click();
	await page.getByText('I have saved these codes somewhere safe').click();
	await page.getByRole('link', { name: 'Continue to dashboard' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
}

export async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('Email').fill(ADMIN.email);
	await page.locator('input[name="password"]').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Continue' }).click();
	await page.waitForURL('**/login/totp');
	await page.locator('input[name="code"]').first().fill(await totp());
	await page.getByRole('button', { name: 'Verify' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
}
