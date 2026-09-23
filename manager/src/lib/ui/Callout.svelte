<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';

	interface Props {
		color?: 'gray' | 'blue' | 'yellow' | 'red' | 'green';
		/** Defaults to info (gray/blue/green) or alert (yellow/red). */
		icon?: IconName;
		title?: string;
		children?: Snippet;
		/** Right-aligned buttons. */
		actions?: Snippet;
	}

	let { color = 'gray', icon, title, children, actions }: Props = $props();
	const ic = $derived<IconName>(
		icon ?? (color === 'yellow' || color === 'red' ? 'alert' : color === 'green' ? 'check' : 'info')
	);
</script>

<div class="callout {color}" role={color === 'red' ? 'alert' : 'note'}>
	<span class="ic"><Icon name={ic} size={20} /></span>
	<div class="body">
		{#if title}<p class="title">{title}</p>{/if}
		{#if children}<div class="content">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.callout {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 14px 16px 14px 12px;
		border-radius: var(--radius);
		font-size: 14px;
		line-height: 1.5;
		color: var(--text);
	}
	.ic {
		display: inline-flex;
		flex: none;
		padding-top: 0;
		color: var(--ic);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: 600;
	}
	.title + .content {
		margin-top: 2px;
	}
	.content {
		color: var(--text);
	}
	.content :global(p + p) {
		margin-top: 6px;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex: none;
		align-self: center;
	}
	.gray {
		background: var(--callout-gray);
		--ic: var(--text-secondary);
	}
	.blue {
		background: var(--callout-blue);
		--ic: var(--dot-blue);
	}
	.yellow {
		background: var(--callout-yellow);
		--ic: var(--dot-yellow);
	}
	.red {
		background: var(--callout-red);
		--ic: var(--dot-red);
	}
	.green {
		background: var(--callout-green);
		--ic: var(--dot-green);
	}
	@media (max-width: 520px) {
		.callout {
			flex-wrap: wrap;
		}
		.actions {
			width: 100%;
			padding-left: 30px;
		}
	}
</style>
