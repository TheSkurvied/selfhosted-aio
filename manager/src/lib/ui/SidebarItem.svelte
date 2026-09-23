<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';

	interface Props {
		label: string;
		icon?: IconName;
		/** Link target. Without it the item renders as a button. */
		href?: string;
		active?: boolean;
		/** Small count or text on the right, e.g. pending jobs. */
		badge?: string | number | null;
		onclick?: (e: MouseEvent) => void;
		/** Submit button inside a <form> (e.g. Sign out). */
		submit?: boolean;
		/** Custom right side content. */
		trailing?: Snippet;
		title?: string;
	}

	let {
		label,
		icon,
		href,
		active = false,
		badge,
		onclick,
		submit = false,
		trailing,
		title
	}: Props = $props();
</script>

{#snippet inner()}
	{#if icon}<span class="ic"><Icon name={icon} size={18} /></span>{/if}
	<span class="lbl">{label}</span>
	{#if trailing}
		{@render trailing()}
	{:else if badge !== undefined && badge !== null && badge !== ''}
		<span class="badge">{badge}</span>
	{/if}
{/snippet}

{#if href}
	<a class="item" class:active {href} aria-current={active ? 'page' : undefined} {onclick} {title}>
		{@render inner()}
	</a>
{:else}
	<button type={submit ? 'submit' : 'button'} class="item" class:active {onclick} {title}>
		{@render inner()}
	</button>
{/if}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 30px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius-lg);
		background: transparent;
		color: var(--text-secondary);
		font-size: 14px;
		font-weight: 500;
		text-align: left;
		text-decoration: none;
		white-space: nowrap;
		transition:
			background var(--ease),
			color var(--ease);
	}
	.item:hover {
		background: var(--bg-hover);
	}
	.item:active {
		background: var(--bg-pressed);
	}
	.item.active {
		background: var(--bg-pressed);
		color: var(--text);
	}
	:global(:root:not([data-theme='dark'])) .item.active {
		background: rgba(55, 53, 47, 0.08);
	}
	.ic {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		flex: none;
		color: var(--text-secondary);
	}
	.active .ic {
		color: var(--text);
	}
	.lbl {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.badge {
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		border-radius: 9px;
		background: var(--bg-pressed);
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 500;
		line-height: 18px;
		text-align: center;
	}
</style>
