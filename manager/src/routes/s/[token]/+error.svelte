<script lang="ts">
	import { page } from '$app/state';
	import { Icon } from '$lib/ui';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? 'Link expired' : 'Something went wrong'}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="gone">
	<div class="inner">
		<span class="ic"><Icon name={notFound ? 'clock' : 'alert'} size={40} strokeWidth={1.25} /></span>
		{#if notFound}
			<h1>This link has expired or is not valid</h1>
			<p>
				Setup links only work for a limited time. Ask the person who sent it to you for a new one.
				Addons you already installed keep working.
			</p>
		{:else}
			<h1>Something went wrong</h1>
			<p>Try opening the link again in a minute.</p>
		{/if}
	</div>
</main>

<style>
	.gone {
		display: flex;
		justify-content: center;
		min-height: 100vh;
		padding: 18vh 16px 48px;
		background: var(--bg);
		color: var(--text);
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
	h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 600;
	}
	p {
		margin: 0;
		color: var(--text-secondary);
	}
</style>
