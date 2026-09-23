<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';
	import type { TabItem } from './types';

	interface Props {
		tabs: TabItem[];
		/** id of the active tab. */
		active?: string;
		onchange?: (id: string) => void;
		/** Accessible name for the tab list. */
		label?: string;
		/** Prefix for panel ids: tab `x` controls element `${panelPrefix}-x`. */
		panelPrefix?: string;
	}

	let {
		tabs,
		active = $bindable(tabs[0]?.id),
		onchange,
		label = 'Views',
		panelPrefix
	}: Props = $props();

	let list: HTMLElement | undefined = $state();

	function select(id: string) {
		active = id;
		onchange?.(id);
	}

	function onkeydown(e: KeyboardEvent) {
		const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
		if (!keys.includes(e.key) || !list) return;
		e.preventDefault();
		const idx = tabs.findIndex((t) => t.id === active);
		let next = idx;
		if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
		if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
		if (e.key === 'Home') next = 0;
		if (e.key === 'End') next = tabs.length - 1;
		const t = tabs[next];
		if (!t.href) select(t.id);
		list.querySelectorAll<HTMLElement>('[data-tab]')[next]?.focus();
	}
</script>

<div class="tabs" role="tablist" aria-label={label} bind:this={list} tabindex="-1" {onkeydown}>
	{#each tabs as t (t.id)}
		{@const sel = t.id === active}
		{#if t.href}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- consumers pass app paths -->
			<a
				data-tab
				href={t.href}
				class="tab"
				class:sel
				role="tab"
				aria-selected={sel}
				tabindex={sel ? 0 : -1}
				onclick={() => select(t.id)}
			>
				{#if t.icon}<Icon name={t.icon} size={16} />{/if}
				<span>{t.label}</span>
				{#if t.count !== undefined}<span class="count">{t.count}</span>{/if}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{:else}
			<button
				data-tab
				type="button"
				class="tab"
				class:sel
				role="tab"
				aria-selected={sel}
				aria-controls={panelPrefix ? `${panelPrefix}-${t.id}` : undefined}
				tabindex={sel ? 0 : -1}
				onclick={() => select(t.id)}
			>
				{#if t.icon}<Icon name={t.icon} size={16} />{/if}
				<span>{t.label}</span>
				{#if t.count !== undefined}<span class="count">{t.count}</span>{/if}
			</button>
		{/if}
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		align-items: stretch;
		gap: 2px;
		border-bottom: 1px solid var(--divider);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs:focus {
		box-shadow: none;
	}
	.tab {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 2px;
		margin: 0 6px 0 0;
		border: 0;
		background: transparent;
		font-size: 14px;
		font-weight: 500;
		color: var(--text-secondary);
		text-decoration: none;
		white-space: nowrap;
	}
	.tab > :global(*) {
		position: relative;
	}
	.tab::before {
		content: '';
		position: absolute;
		inset: 6px -4px;
		border-radius: var(--radius);
		transition: background var(--ease);
	}
	.tab:hover::before {
		background: var(--bg-hover);
	}
	.tab.sel {
		color: var(--text);
	}
	.tab.sel::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		background: var(--text);
		border-radius: 1px;
	}
	.tab:focus-visible {
		box-shadow: none;
	}
	.tab:focus-visible::before {
		box-shadow: var(--focus-ring);
	}
	.count {
		font-size: 12px;
		color: var(--text-tertiary);
		font-weight: 400;
	}
</style>
