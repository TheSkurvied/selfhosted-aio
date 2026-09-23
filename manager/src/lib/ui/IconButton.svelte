<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';

	interface Props extends Omit<HTMLButtonAttributes, 'children'> {
		icon: IconName;
		/** Required accessible name; also shown as a native tooltip. */
		label: string;
		size?: 'sm' | 'md';
		/** Pressed/active look (e.g. toggles). */
		active?: boolean;
		href?: string;
	}

	let {
		icon,
		label,
		size = 'md',
		active = false,
		href,
		type = 'button',
		class: klass = '',
		...rest
	}: Props = $props();

	const px = $derived(size === 'sm' ? 16 : 18);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- consumers pass app paths -->
	<a {href} class="ib {size} {klass}" class:active aria-label={label} title={label}>
		<Icon name={icon} size={px} />
	</a>
{:else}
	<button {type} class="ib {size} {klass}" class:active aria-label={label} title={label} {...rest}>
		<Icon name={icon} size={px} />
	</button>
{/if}

<style>
	.ib {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		flex: none;
		transition:
			background var(--ease),
			color var(--ease);
	}
	.ib.sm {
		width: 24px;
		height: 24px;
	}
	.ib:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}
	.ib:active:not(:disabled),
	.ib.active {
		background: var(--bg-pressed);
		color: var(--text);
	}
	.ib:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
