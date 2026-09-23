<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Callout from '$lib/ui/Callout.svelte';
	import Divider from '$lib/ui/Divider.svelte';

	let { data, form } = $props();
	let pending = $state(false);
	const error = $derived(form?.error ?? data.ssoError ?? null);
</script>

<svelte:head><title>Log in - AIO Manager</title></svelte:head>

<div class="auth-head">
	<h1 class="auth-title">Log in</h1>
	<p class="auth-sub">Sign in to manage your AIOStreams and AIOMetadata configs.</p>
</div>

{#if data.oidcEnabled}
	<Button href="/auth/oidc" size="lg" block icon="lock">Continue with SSO</Button>
	<Divider label="or" space={20} />
{/if}

<form
	method="POST"
	class="auth-form"
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			await update({ reset: false });
			pending = false;
		};
	}}
>
	{#if error}
		<Callout color="red">{error}</Callout>
	{/if}
	<Input
		label="Email"
		name="email"
		type="email"
		autocomplete="username"
		placeholder="Enter your email address"
		value={form?.email ?? ''}
		required
		size="lg"
	/>
	<Input
		label="Password"
		name="password"
		type="password"
		autocomplete="current-password"
		placeholder="Enter your password"
		required
		size="lg"
	/>
	<Button type="submit" variant="primary" size="lg" block loading={pending}>Continue</Button>
</form>

<p class="auth-foot">
	You will be asked for a code from your authenticator app next. Lost access? Run
	<code>scripts/reset-admin.ts</code> on the server.
</p>
