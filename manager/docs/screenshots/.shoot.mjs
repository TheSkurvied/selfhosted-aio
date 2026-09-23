// Temporary DESIGN verification script (deleted after use).
import { chromium } from '@playwright/test';
import { generateTOTP } from '@oslojs/otp';
import { decodeBase32IgnorePadding } from '@oslojs/encoding';

const BASE = process.env.BASE ?? 'http://localhost:5199';
const OUT = new URL('./', import.meta.url).pathname;
const only = process.argv[2] ?? 'all';
const variants = [
	{ name: 'light-desktop', colorScheme: 'light', viewport: { width: 1280, height: 860 } },
	{ name: 'dark-desktop', colorScheme: 'dark', viewport: { width: 1280, height: 860 } },
	{ name: 'light-mobile', colorScheme: 'light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
	{ name: 'dark-mobile', colorScheme: 'dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
];
const EMAIL = 'admin@example.com';
const PASS = 'correct horse battery staple';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const shot = async (page, file, full = true) => {
	await page.waitForTimeout(250);
	await page.screenshot({ path: `${OUT}${file}.png`, fullPage: full });
	console.log('saved', file);
};
const ctxFor = (v, extra = {}) => browser.newContext({ colorScheme: v.colorScheme, viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor ?? 1, ...extra });

let secret = null;
if (only === 'all' || only === 'setup') {
	let last;
	for (const v of variants) {
		const ctx = await ctxFor(v);
		const page = await ctx.newPage();
		await page.goto(BASE + '/setup');
		await shot(page, `setup-1-account-${v.name}`, false);
		await page.fill('input[name=email]', EMAIL);
		await page.fill('input[name=password]', PASS);
		await page.fill('input[name=password2]', PASS);
		await page.click('button[type=submit]');
		await page.waitForSelector('input[name=code]');
		await page.getByText("Can't scan").click();
		await shot(page, `setup-2-totp-${v.name}`, true);
		last = { ctx, page, v };
		if (v !== variants[variants.length - 1]) await ctx.close();
	}
	const { ctx, page, v } = last;
	secret = (await page.locator('.secret-text').innerText()).replace(/\s/g, '');
	const code = generateTOTP(decodeBase32IgnorePadding(secret), 30, 6);
	await page.fill('input[name=code]', code);
	await page.click('form[action="?/confirm"] button[type=submit]');
	await page.waitForSelector('.codes');
	await shot(page, `setup-3-codes-${v.name}`, true);
	await ctx.storageState({ path: OUT + '.state.json' });
	await ctx.close();
}

if (only === 'all' || only === 'login') {
	for (const v of variants) {
		const ctx = await ctxFor(v);
		const page = await ctx.newPage();
		await page.goto(BASE + '/login');
		await shot(page, `login-${v.name}`, false);
		await page.fill('input[name=email]', EMAIL);
		await page.fill('input[name=password]', 'wrong password');
		await page.click('button[type=submit]');
		await page.waitForSelector('[role=alert]');
		if (v.name === 'light-desktop') await shot(page, `login-error-${v.name}`, false);
		await page.fill('input[name=password]', PASS);
		await page.click('button[type=submit]');
		await page.waitForURL('**/login/totp');
		await shot(page, `totp-${v.name}`, false);
		await ctx.close();
	}
}

if (only === 'all' || only === 'app') {
	for (const v of variants) {
		const ctx = await ctxFor(v, { storageState: OUT + '.state.json' });
		const page = await ctx.newPage();
		await page.goto(BASE + '/styleguide');
		await page.waitForSelector('.tbl');
		await page.waitForLoadState('networkidle');
		await shot(page, `styleguide-${v.name}`, true);
		await shot(page, `styleguide-top-${v.name}`, false);
		for (const id of ['buttons', 'forms', 'tags', 'blocks', 'table', 'editing', 'overlays', 'nav']) {
			const box = await page.evaluate((id) => {
				const r = document.getElementById(id).getBoundingClientRect();
				return { x: 0, y: r.top + scrollY, width: innerWidth, height: r.height };
			}, id);
			await page.screenshot({ path: `${OUT}.sec-${id}-${v.name}.png`, fullPage: true, clip: box });
		}
		await page.evaluate(() => window.scrollTo(0, 0));
		if (v.isMobile) {
			await page.click('button[aria-label="Open sidebar"]');
			await shot(page, `sidebar-open-${v.name}`, false);
			await page.keyboard.press('Escape');
		} else {
			await page.getByRole('button', { name: 'Open modal' }).click();
			await shot(page, `modal-${v.name}`, false);
			await page.keyboard.press('Escape');
			await page.getByRole('button', { name: 'Row actions' }).click();
			await shot(page, `menu-${v.name}`, false);
			await page.keyboard.press('Escape');
			await page.getByRole('button', { name: 'Error toast' }).click();
			await page.getByRole('button', { name: 'Success toast' }).click();
			await shot(page, `toast-${v.name}`, false);
			await page.goto(BASE + '/styleguide');
			await page.waitForLoadState('networkidle');
			await page.hover('.sb');
			await page.click('.sb button[aria-label="Close sidebar"]');
			await shot(page, `collapsed-${v.name}`, false);
			await page.click('button[aria-label="Open sidebar"]');
		}
		await page.goto(BASE + '/does-not-exist');
		await shot(page, `error-404-${v.name}`, false);
		await ctx.close();
	}
}
await browser.close();
