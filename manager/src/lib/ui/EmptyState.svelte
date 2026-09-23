<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';

	interface Props {
		title: string;
		description?: string;
		icon?: IconName;
		/** Buttons under the text. */
		action?: Snippet;
		/** Less vertical padding, e.g. inside a table. */
		compact?: boolean;
	}

	let { title, description, icon, action, compact = false }: Props = $props();
</script>

<div class="empty" class:compact>
	{#if icon}<span class="ic"><Icon name={icon} size={compact ? 24 : 32} strokeWidth={1.25} /></span
		>{/if}
	<p class="title">{title}</p>
	{#if description}<p class="desc">{description}</p>{/if}
	{#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 64px 16px;
		color: var(--text-secondary);
	}
	.empty.compact {
		padding: 28px 16px;
	}
	.ic {
		color: var(--text-tertiary);
		margin-bottom: 12px;
	}
	.title {
		font-size: 14px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.desc {
		margin-top: 4px;
		font-size: 14px;
		color: var(--text-tertiary);
		max-width: 400px;
	}
	.action {
		margin-top: 16px;
		display: flex;
		gap: 8px;
	}
</style>
