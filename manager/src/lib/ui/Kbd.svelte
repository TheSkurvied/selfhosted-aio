<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<kbd>{@render children()}</kbd>

<style>
	kbd {
		display: inline-flex;
		align-items: center;
		height: 18px;
		min-width: 18px;
		padding: 0 5px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		box-shadow: inset 0 -1px 0 var(--border-input);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 500;
		line-height: 1;
		color: var(--text-secondary);
		white-space: nowrap;
	}
</style>
