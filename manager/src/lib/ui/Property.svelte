<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';

	interface Props {
		label: string;
		icon?: IconName;
		/** Value text; or pass children for rich values. */
		value?: string | number | null;
		/** Shown in tertiary color when there is no value. */
		empty?: string;
		/** Monospace value (ids, hashes). */
		mono?: boolean;
		children?: Snippet;
	}

	let { label, icon, value, empty = 'Empty', mono = false, children }: Props = $props();
</script>

<div class="prop" role="listitem">
	<div class="label">
		{#if icon}<Icon name={icon} size={16} />{/if}
		<span>{label}</span>
	</div>
	<div class="value" class:mono>
		{#if children}
			{@render children()}
		{:else if value === null || value === undefined || value === ''}
			<span class="empty">{empty}</span>
		{:else}
			{value}
		{/if}
	</div>
</div>

<style>
	.prop {
		display: flex;
		align-items: flex-start;
		min-height: 34px;
		font-size: 14px;
		line-height: 20px;
	}
	.label {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
		width: var(--prop-label-w, 160px);
		min-height: 34px;
		padding: 0 6px;
		color: var(--text-secondary);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.label span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.value {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		flex: 1;
		min-width: 0;
		min-height: 34px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.value.mono {
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.empty {
		color: var(--text-tertiary);
	}
	@media (max-width: 520px) {
		.label {
			width: 120px;
		}
	}
</style>
