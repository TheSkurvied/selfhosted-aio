<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Callout from '$lib/ui/Callout.svelte';
	import CopyButton from '$lib/ui/CopyButton.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import ToggleBlock from '$lib/ui/ToggleBlock.svelte';

	interface TotpStep {
		step: 'totp';
		totpUri: string;
		totpSecret: string;
		qrSvg: string;
	}

	let { data, form } = $props();
	let pending = $state(false);
	let saved = $state(false);

	// Keep the TOTP step on screen when a confirm attempt fails without echoing it back.
	let lastTotp = $state<TotpStep | null>(null);
	$effect(() => {
		if (form && 'qrSvg' in form && form.qrSvg) lastTotp = form as unknown as TotpStep;
	});

	const recoveryCodes = $derived<string[] | null>(
		form && 'recoveryCodes' in form ? (form.recoveryCodes as string[]) : null
	);
	const error = $derived<string | null>(form && 'error' in form ? (form.error as string) : null);
	const step = $derived<'account' | 'totp' | 'codes' | 'done'>(
		recoveryCodes ? 'codes' : data.done ? 'done' : lastTotp ? 'totp' : 'account'
	);
	const stepIndex = $derived(step === 'account' ? 0 : step === 'totp' ? 1 : 2);
	const prefillEmail = $derived(form && 'email' in form ? String(form.email ?? '') : '');

	/** Groups the base32 secret in blocks of four for easier manual entry. */
	const groupedSecret = $derived(lastTotp?.totpSecret.replace(/(.{4})/g, '$1 ').trim() ?? '');

	function download() {
		if (!recoveryCodes) return;
		const text =
			'AIO Manager recovery codes\n' +
			`Generated ${new Date().toISOString()}\n` +
			'Each code can be used once instead of an authenticator code.\n\n' +
			recoveryCodes.join('\n') +
			'\n';
		const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'aio-manager-recovery-codes.txt';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function submitting() {
		pending = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			pending = false;
		};
	}
</script>

<svelte:head><title>Set up - AIO Manager</title></svelte:head>

<ol class="steps" aria-label="Setup progress">
	{#each ['Account', 'Authenticator', 'Recovery codes'] as label, i (label)}
		<li class:done={i < stepIndex} class:current={i === stepIndex} aria-current={i === stepIndex ? 'step' : undefined}>
			<span class="num">{i + 1}</span>{label}
		</li>
	{/each}
</ol>

{#if step === 'account'}
	<div class="auth-head">
		<h1 class="auth-title">Create the admin account</h1>
		<p class="auth-sub">This is the first run. The account you create here manages everything.</p>
	</div>
	<form method="POST" action="?/setup" class="auth-form" use:enhance={submitting}>
		{#if error}<Callout color="red">{error}</Callout>{/if}
		<Input
			label="Email"
			name="email"
			type="email"
			autocomplete="username"
			placeholder="you@example.com"
			value={prefillEmail}
			required
			size="lg"
		/>
		<Input
			label="Password"
			name="password"
			type="password"
			autocomplete="new-password"
			hint="At least 12 characters. A passphrase works well."
			required
			minlength={12}
			size="lg"
		/>
		<Input
			label="Confirm password"
			name="password2"
			type="password"
			autocomplete="new-password"
			required
			size="lg"
		/>
		<Button type="submit" variant="primary" size="lg" block loading={pending}>Continue</Button>
	</form>
{:else if step === 'totp' && lastTotp}
	<div class="auth-head">
		<h1 class="auth-title">Set up two-factor authentication</h1>
		<p class="auth-sub">
			Scan this QR code with an authenticator app such as 1Password, Aegis or Google
			Authenticator, then enter the 6-digit code it shows.
		</p>
	</div>
	<div class="qr-block">
		<QrCode svg={lastTotp.qrSvg} size={184} label="QR code for your authenticator app" />
	</div>
	<ToggleBlock title="Can't scan? Enter the key manually">
		<div class="secret">
			<code class="secret-text">{groupedSecret}</code>
			<CopyButton value={lastTotp.totpSecret} ariaLabel="Copy setup key" copiedMessage="Setup key copied" />
		</div>
		<p class="secret-hint">Time-based, 6 digits, 30 seconds.</p>
	</ToggleBlock>
	<form method="POST" action="?/confirm" class="auth-form confirm" use:enhance={submitting}>
		{#if error}<Callout color="red">{error}</Callout>{/if}
		<Input
			label="Authentication code"
			name="code"
			inputmode="numeric"
			autocomplete="one-time-code"
			pattern="[0-9 ]*"
			maxlength={7}
			placeholder="123 456"
			mono
			required
			size="lg"
		/>
		<Button type="submit" variant="primary" size="lg" block loading={pending}>Verify and finish</Button>
	</form>
{:else if step === 'codes' && recoveryCodes}
	<div class="auth-head">
		<h1 class="auth-title">Save your recovery codes</h1>
		<p class="auth-sub">
			If you lose your authenticator, each of these codes signs you in once. They will not be
			shown again.
		</p>
	</div>
	<div class="codes">
		<ul>
			{#each recoveryCodes as code (code)}<li>{code}</li>{/each}
		</ul>
		<div class="codes-actions">
			<CopyButton value={recoveryCodes.join('\n')} label="Copy" size="sm" copiedMessage="Recovery codes copied" />
			<Button size="sm" icon="download" onclick={download}>Download</Button>
		</div>
	</div>
	<div class="ack">
		<Checkbox bind:checked={saved} label="I have saved these codes somewhere safe" />
	</div>
	<Button href={saved ? '/' : undefined} disabled={!saved} variant="primary" size="lg" block>
		Continue to dashboard
	</Button>
{:else}
	<div class="auth-head">
		<h1 class="auth-title">Setup is complete</h1>
		<p class="auth-sub">Your admin account is ready.</p>
	</div>
	<Button href="/" variant="primary" size="lg" block>Go to dashboard</Button>
{/if}

<style>
	.steps {
		display: flex;
		gap: 16px;
		margin: 0 0 28px;
		padding: 0;
		list-style: none;
		font-size: 12px;
		color: var(--text-tertiary);
		flex-wrap: wrap;
	}
	.steps li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px var(--border-input);
		font-size: 11px;
		font-weight: 600;
	}
	.steps li.current {
		color: var(--text);
		font-weight: 500;
	}
	.steps li.current .num {
		background: var(--text);
		color: var(--bg);
		box-shadow: none;
	}
	.steps li.done .num {
		background: var(--tag-green-bg);
		color: var(--tag-green-text);
		box-shadow: none;
	}
	.qr-block {
		display: flex;
		justify-content: center;
		margin-bottom: 12px;
	}
	.secret {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 8px 8px 12px;
		border-radius: var(--radius);
		background: var(--bg-code-block);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.secret-text {
		flex: 1;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: 13px;
		letter-spacing: 0.04em;
		word-break: break-all;
		color: var(--text);
		background: none;
		padding: 0;
	}
	.secret-hint {
		margin-top: 6px;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.confirm {
		margin-top: 20px;
	}
	.codes {
		border-radius: var(--radius-lg);
		box-shadow: inset 0 0 0 1px var(--border);
		overflow: hidden;
	}
	.codes ul {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 16px;
		margin: 0;
		padding: 16px 20px;
		list-style: none;
		background: var(--bg-code-block);
		font-family: var(--font-mono);
		font-size: 14px;
		letter-spacing: 0.02em;
		color: var(--text);
	}
	.codes-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 8px;
		border-top: 1px solid var(--divider);
	}
	.ack {
		margin: 20px 0 16px;
	}
</style>
