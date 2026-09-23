<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		/** Label column width, default 160px. */
		labelWidth?: string;
		class?: string;
	}

	let { children, labelWidth = '160px', class: klass = '' }: Props = $props();
</script>

<div class="props {klass}" style:--prop-label-w={labelWidth} role="list">
	{@render children()}
</div>

<style>
	.props {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 0;
	}
</style>
