<script lang="ts">
	import JsonNode from './JsonNode.svelte';

	interface Props {
		value: unknown;
		/** Levels open on first render (0 = everything collapsed). */
		expandDepth?: number;
		/** Max height in px before scrolling; 0 for none. */
		maxHeight?: number;
		label?: string;
	}

	let { value, expandDepth = 2, maxHeight = 480, label = 'JSON' }: Props = $props();
</script>

<div
	class="jv"
	role="group"
	aria-label={label}
	style:max-height={maxHeight ? `${maxHeight}px` : undefined}
>
	<JsonNode {value} depth={0} {expandDepth} last />
</div>

<style>
	.jv {
		padding: 10px 12px 10px 6px;
		border-radius: var(--radius);
		background: var(--bg-code-block);
		box-shadow: inset 0 0 0 1px var(--border);
		font-family: var(--font-mono);
		font-size: 12.5px;
		line-height: 20px;
		overflow: auto;
		color: var(--text);
	}
</style>
