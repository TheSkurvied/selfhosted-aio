<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Summary text; or use the `summary` snippet. */
		title?: string;
		summary?: Snippet;
		open?: boolean;
		/** Heading-sized summary (Notion toggle heading). */
		heading?: boolean;
		children: Snippet;
	}

	let { title, summary, open = $bindable(false), heading = false, children }: Props = $props();
	const uid = $props.id();
</script>

<div class="tb" class:open class:heading>
	<button
		type="button"
		class="summary"
		aria-expanded={open}
		aria-controls="tb-{uid}"
		onclick={() => (open = !open)}
	>
		<span class="caret" aria-hidden="true">
			<svg width="10" height="10" viewBox="0 0 10 10"
				><path d="M3 1.5v7l5-3.5Z" fill="currentColor" /></svg
			>
		</span>
		<span class="label"
			>{#if summary}{@render summary()}{:else}{title}{/if}</span
		>
	</button>
	{#if open}
		<div class="content" id="tb-{uid}">{@render children()}</div>
	{/if}
</div>

<style>
	.tb {
		font-size: 16px;
	}
	.summary {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		min-height: 30px;
		padding: 3px 2px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		text-align: left;
		font-size: inherit;
		line-height: 1.5;
		color: var(--text);
	}
	.heading .summary {
		font-size: 18px;
		font-weight: 600;
	}
	.caret {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: var(--radius);
		color: var(--text);
		transition:
			transform 150ms ease,
			background var(--ease);
	}
	.summary:hover .caret {
		background: var(--bg-hover);
	}
	.open .caret {
		transform: rotate(90deg);
	}
	.label {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.content {
		padding: 4px 0 8px 26px;
	}
</style>
