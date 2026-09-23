<script lang="ts">
	interface Props {
		/** Optional centered label, e.g. "or". */
		label?: string;
		/** Vertical spacing in px (top and bottom). */
		space?: number;
	}
	let { label, space = 8 }: Props = $props();
</script>

{#if label}
	<div class="labeled" role="separator" style:margin="{space}px 0">
		<span>{label}</span>
	</div>
{:else}
	<hr style:margin="{space}px 0" />
{/if}

<style>
	hr {
		border: 0;
		border-top: 1px solid var(--divider);
		width: 100%;
	}
	.labeled {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.labeled::before,
	.labeled::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--divider);
	}
</style>
