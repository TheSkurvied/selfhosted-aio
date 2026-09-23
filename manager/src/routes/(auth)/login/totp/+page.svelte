<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Callout from '$lib/ui/Callout.svelte';

	let { form } = $props();
	let pending = $state(false);
	let useRecovery = $state(false);
	let codeInput: HTMLInputElement | null = $state(null);

	$effect(() => {
		codeInput?.focus();
	});
</script>

<svelte:head><title>Two-factor code - AIO Manager</title></svelte:head>

<div class="auth-head">
	<h1 class="auth-title">Two-factor authentication</h1>
	<p class="auth-sub">
		{#if useRecovery}
			Enter one of the recovery codes you saved during setup. Each code works once.
		{:else}
			Enter the 6-digit code from your authenticator app.
		{/if}
	</p>
</div>

<form
	method="POST"
	class="auth-form"
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			await update();
			pending = false;
		};
	}}
>
	{#if form?.error}
		<Callout color="red">{form.error}</Callout>
	{/if}
	{#key useRecovery}
		{#if useRecovery}
			<Input
				label="Recovery code"
				name="code"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				placeholder="xxxxx-xxxxx"
				mono
				required
				size="lg"
				bind:ref={codeInput}
			/>
		{:else}
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
				bind:ref={codeInput}
			/>
		{/if}
	{/key}
	<Button type="submit" variant="primary" size="lg" block loading={pending}>Verify</Button>
</form>

<div class="alt">
	<button type="button" class="link" onclick={() => (useRecovery = !useRecovery)}>
		{useRecovery ? 'Use your authenticator app' : 'Use a recovery code instead'}
	</button>
	<a class="link" href={resolve('/login')}>Back to log in</a>
</div>

<style>
	.alt {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 20px;
		font-size: 13px;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--text-secondary);
		font-size: 13px;
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 2px;
	}
	.link:hover {
		color: var(--text);
	}
</style>
