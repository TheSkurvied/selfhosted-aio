<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';

	interface Props {
		title: string;
		/** Large line icon above the title (Notion page icon position). */
		icon?: IconName;
		description?: string;
		/** Buttons aligned with the title on the right. */
		actions?: Snippet;
		/** Extra content under the description (e.g. a PropertyList or Tabs). */
		children?: Snippet;
		/** Suffix after the title in tertiary color, e.g. a count. */
		meta?: string | number;
	}

	let { title, icon, description, actions, children, meta }: Props = $props();
</script>

<header class="ph" class:with-icon={!!icon}>
	{#if icon}
		<div class="icon"><Icon name={icon} size={48} strokeWidth={1.25} /></div>
	{/if}
	<div class="title-row">
		<h1>
			{title}{#if meta !== undefined}<span class="meta">{meta}</span>{/if}
		</h1>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{#if description}<p class="desc">{description}</p>{/if}
	{#if children}<div class="extra">{@render children()}</div>{/if}
</header>

<style>
	.ph {
		padding-top: 72px;
		padding-bottom: 20px;
	}
	.ph.with-icon {
		padding-top: 48px;
	}
	.icon {
		display: flex;
		width: 78px;
		height: 78px;
		align-items: center;
		justify-content: flex-start;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.title-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	h1 {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.meta {
		margin-left: 12px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-bottom: 6px;
		flex-wrap: wrap;
	}
	.desc {
		margin-top: 8px;
		color: var(--text-secondary);
		font-size: 16px;
		max-width: 680px;
	}
	.extra {
		margin-top: 16px;
	}
	@media (max-width: 768px) {
		.ph {
			padding-top: 32px;
		}
		.ph.with-icon {
			padding-top: 24px;
		}
		.icon {
			width: 56px;
			height: 56px;
		}
	}
</style>
