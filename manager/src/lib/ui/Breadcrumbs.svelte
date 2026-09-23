<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';
	import type { Crumb } from './types';

	interface Props {
		items: Crumb[];
	}

	let { items }: Props = $props();
</script>

<nav class="bc" aria-label="Breadcrumb">
	<ol>
		{#each items as item, i (i)}
			{@const last = i === items.length - 1}
			<li class:last>
				{#if item.href && !last}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- consumers pass app paths -->
					<a class="crumb" href={item.href}>
						{#if item.icon}<Icon name={item.icon} size={16} />{/if}
						<span>{item.label}</span>
					</a>
				{:else}
					<span class="crumb" aria-current={last ? 'page' : undefined}>
						{#if item.icon}<Icon name={item.icon} size={16} />{/if}
						<span>{item.label}</span>
					</span>
				{/if}
				{#if !last}<span class="sep" aria-hidden="true">/</span>{/if}
			</li>
		{/each}
	</ol>
</nav>

<style>
	.bc {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}
	ol {
		display: flex;
		align-items: center;
		margin: 0;
		padding: 0;
		list-style: none;
		min-width: 0;
		font-size: 14px;
		line-height: 1.2;
	}
	li {
		display: flex;
		align-items: center;
		min-width: 0;
		flex-shrink: 1;
	}
	li.last {
		flex-shrink: 0;
		max-width: 60%;
	}
	.crumb {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 6px;
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
		white-space: nowrap;
		min-width: 0;
		transition: background var(--ease);
	}
	.crumb span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	a.crumb {
		color: var(--text-secondary);
	}
	a.crumb:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.crumb :global(svg) {
		color: var(--text-secondary);
	}
	.sep {
		color: var(--text-tertiary);
		margin: 0 1px;
		flex: none;
	}
</style>
