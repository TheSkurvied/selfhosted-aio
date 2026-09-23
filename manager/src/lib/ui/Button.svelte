<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';
	import Spinner from './Spinner.svelte';

	interface Props extends Omit<HTMLButtonAttributes, 'children'> {
		variant?: 'default' | 'primary' | 'danger' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		/** Leading icon. */
		icon?: IconName;
		/** Trailing icon (e.g. 'chevron-down' for dropdown buttons). */
		iconRight?: IconName;
		/** Shows a spinner and disables the button. */
		loading?: boolean;
		/** Render as a link instead of a button. */
		href?: string;
		target?: string;
		rel?: string;
		/** Stretch to the container width. */
		block?: boolean;
		children?: Snippet;
	}

	let {
		variant = 'default',
		size = 'md',
		icon,
		iconRight,
		loading = false,
		href,
		target,
		rel,
		block = false,
		type = 'button',
		disabled,
		class: klass = '',
		children,
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'sm' ? 14 : 16);
</script>

{#snippet inner()}
	{#if loading}
		<Spinner size={iconSize} />
	{:else if icon}
		<Icon name={icon} size={iconSize} />
	{/if}
	{#if children}<span class="label">{@render children()}</span>{/if}
	{#if iconRight}<Icon name={iconRight} size={iconSize - 2} class="trail" />{/if}
{/snippet}

{#if href && !disabled}
	<a
		{href}
		{target}
		{rel}
		class="btn {variant} {size} {klass}"
		class:block
		class:icon-only={!children}
		aria-busy={loading || undefined}
	>
		{@render inner()}
	</a>
{:else}
	<button
		{type}
		class="btn {variant} {size} {klass}"
		class:block
		class:icon-only={!children}
		disabled={disabled || loading}
		aria-busy={loading || undefined}
		{...rest}
	>
		{@render inner()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--radius);
		font-size: 14px;
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
		text-decoration: none;
		user-select: none;
		cursor: pointer;
		transition:
			background var(--ease),
			box-shadow var(--ease),
			color var(--ease);
		flex: none;
	}
	.btn.sm {
		height: 28px;
		padding: 0 8px;
		font-size: 14px;
		gap: 4px;
	}
	.btn.lg {
		height: 36px;
		padding: 0 14px;
		font-size: 14px;
	}
	.btn.block {
		display: flex;
		width: 100%;
	}
	.btn.icon-only {
		padding: 0;
		width: 32px;
	}
	.btn.sm.icon-only {
		width: 28px;
	}

	.default {
		background: var(--bg);
		color: var(--text);
		box-shadow: var(--shadow-button);
	}
	.default:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.default:active:not(:disabled) {
		background: var(--bg-pressed);
	}

	.primary {
		background: var(--accent);
		color: var(--text-on-accent);
		box-shadow:
			inset 0 0 0 1px rgba(15, 15, 15, 0.1),
			0 1px 2px rgba(15, 15, 15, 0.1);
	}
	.primary:hover:not(:disabled) {
		background: var(--accent-hover);
	}
	.primary:active:not(:disabled) {
		background: var(--accent-pressed);
	}

	.danger {
		background: var(--bg);
		color: var(--danger-text);
		box-shadow:
			inset 0 0 0 1px var(--danger-border),
			0 1px 2px rgba(15, 15, 15, 0.05);
	}
	.danger:hover:not(:disabled) {
		background: var(--danger-hover);
	}

	.ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	.ghost:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}
	.ghost:active:not(:disabled) {
		background: var(--bg-pressed);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.btn[aria-busy='true'] {
		opacity: 0.7;
	}
	.btn:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.label {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.btn :global(.trail) {
		opacity: 0.6;
		margin-right: -2px;
	}
</style>
