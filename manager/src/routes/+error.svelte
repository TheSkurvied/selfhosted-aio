<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/icons/Icon.svelte';
	import Button from '$lib/ui/Button.svelte';

	const status = $derived(page.status);
	const heading = $derived(
		status === 404
			? 'This page could not be found'
			: status === 403
				? 'You do not have access to this page'
				: status >= 500
					? 'Something went wrong'
					: 'This request could not be completed'
	);
	const detail = $derived(
		status === 404
			? 'It may have been deleted, or the link is wrong.'
			: (page.error?.message ?? 'Try again in a moment.')
	);
</script>

<svelte:head><title>{status} - AIO Manager</title></svelte:head>

<div class="err">
	<div class="inner">
		<span class="ic"><Icon name={status === 404 ? 'file' : 'alert'} size={40} strokeWidth={1.25} /></span>
		<p class="code">Error {status}</p>
		<h1>{heading}</h1>
		<p class="detail">{detail}</p>
		<div class="actions">
			<Button href="/" variant="primary" icon="home">Back to dashboard</Button>
			<Button onclick={() => history.back()} variant="default">Go back</Button>
		</div>
	</div>
</div>

<style>
	.err {
		display: flex;
		justify-content: center;
		min-height: 100vh;
		padding: 18vh 16px 48px;
		background: var(--bg);
	}
	.inner {
		max-width: 440px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.ic {
		color: var(--text-tertiary);
		margin-bottom: 16px;
	}
	.code {
		font-size: 12px;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
	}
	h1 {
		margin-top: 8px;
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.detail {
		margin-top: 8px;
		font-size: 14px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 24px;
		flex-wrap: wrap;
		justify-content: center;
	}
</style>
