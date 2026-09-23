/**
 * Reset an admin's password and/or TOTP from the server shell.
 *
 *   pnpm tsx scripts/reset-admin.ts <email> [--password] [--totp] [--create]
 *   (in the container: docker compose exec manager node build/cli/reset-admin.mjs <email> ...)
 *
 * With neither --password nor --totp, both are reset. The new password is read
 * from RESET_PASSWORD or prompted. A new TOTP secret and 5 recovery codes are
 * printed once. All of the admin's sessions are ended.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { audit } from '../src/lib/server/audit';
import { hashPassword, passwordProblem } from '../src/lib/server/auth/password';
import { generateRecoveryCodes } from '../src/lib/server/auth/recovery';
import { sealTotpKey } from '../src/lib/server/auth/second-factor';
import { generateTotpKey, totpSecretBase32, totpUri } from '../src/lib/server/auth/totp';
import { closeDb, db, t } from '../src/lib/server/db';

async function prompt(question: string): Promise<string> {
	let muted = false;
	const output = new Writable({
		write(chunk, _enc, cb) {
			if (!muted) process.stdout.write(chunk);
			cb();
		}
	});
	const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
	process.stdout.write(question);
	muted = true;
	const answer = await new Promise<string>((resolve) => rl.question('', resolve));
	rl.close();
	process.stdout.write('\n');
	return answer;
}

async function main() {
	const args = process.argv.slice(2);
	const email = args
		.find((a) => !a.startsWith('--'))
		?.trim()
		.toLowerCase();
	if (!email) {
		console.error('Usage: reset-admin.ts <email> [--password] [--totp] [--create]');
		process.exit(2);
	}
	let doPassword = args.includes('--password');
	let doTotp = args.includes('--totp');
	if (!doPassword && !doTotp) doPassword = doTotp = true;

	let [admin] = await db.select().from(t.admins).where(eq(t.admins.email, email));
	if (!admin) {
		if (!args.includes('--create')) {
			console.error(`No admin with email ${email}. Pass --create to add one.`);
			process.exit(1);
		}
		doPassword = doTotp = true;
		[admin] = await db.insert(t.admins).values({ email }).returning();
		console.log(`Created admin ${email}.`);
	}

	const patch: Partial<typeof t.admins.$inferInsert> = {};
	if (doPassword) {
		const pw = process.env.RESET_PASSWORD ?? (await prompt('New password: '));
		const problem = passwordProblem(pw);
		if (problem) {
			console.error(problem);
			process.exit(1);
		}
		patch.passwordHash = await hashPassword(pw);
	}
	let totpInfo: { secret: string; uri: string; codes: string[] } | null = null;
	if (doTotp) {
		const key = generateTotpKey();
		const { codes, hashes } = generateRecoveryCodes();
		patch.totpSecretEnc = sealTotpKey(admin.id, key);
		patch.totpLastCounter = null;
		patch.recoveryCodesHash = hashes;
		totpInfo = { secret: totpSecretBase32(key), uri: totpUri(email, key), codes };
	}

	await db.update(t.admins).set(patch).where(eq(t.admins.id, admin.id));
	await db.delete(t.sessions).where(eq(t.sessions.adminId, admin.id));
	await audit({
		actor: 'system',
		action: 'admin.reset',
		targetType: 'admin',
		targetId: admin.id,
		summary: `Reset from shell: ${[doPassword && 'password', doTotp && 'TOTP'].filter(Boolean).join(' and ')} for ${email}`
	});

	console.log(`Updated ${email}; all sessions ended.`);
	if (totpInfo) {
		console.log(`\nTOTP secret (add to your authenticator): ${totpInfo.secret}`);
		console.log(`otpauth URI: ${totpInfo.uri}`);
		console.log(`\nRecovery codes (shown once):\n  ${totpInfo.codes.join('\n  ')}`);
	}
}

main()
	.catch((err) => {
		console.error(err instanceof Error ? err.message : err);
		process.exitCode = 1;
	})
	.finally(() => closeDb());
