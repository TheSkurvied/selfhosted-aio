<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		id?: string;
		description?: string;
		/** Right side of the heading row (buttons, links). */
		actions?: Snippet;
		children: Snippet;
		level?: 2 | 3;
	}
	let { title, id, description, actions, children, level = 2 }: Props = $props();
</script>

<section class="sec" {id} aria-labelledby={id ? `${id}-h` : undefined}>
	<div class="head">
		<div class="titles">
			{#if level === 2}
				<h2 id={id ? `${id}-h` : undefined}>{title}</h2>
			{:else}
				<h3 id={id ? `${id}-h` : undefined}>{title}</h3>
			{/if}
			{#if description}<p class="desc">{description}</p>{/if}
		</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{@render children()}
</section>

<style>
	.sec {
		margin-top: 40px;
	}
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding-bottom: 8px;
		margin-bottom: 8px;
		border-bottom: 1px solid var(--divider);
	}
	.titles {
		min-width: 0;
	}
	h2,
	h3 {
		margin: 0;
	}
	h2 {
		font-size: 20px;
	}
	.desc {
		margin: 2px 0 0;
		font-size: 14px;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
</style>
