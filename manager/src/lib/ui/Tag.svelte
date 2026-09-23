<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';
	import type { TagColor } from './types';

	interface Props {
		color?: TagColor;
		/** Text; or pass children. */
		label?: string;
		icon?: IconName;
		/** Leading colored dot (Notion "Status" property look). */
		dot?: boolean;
		size?: 'sm' | 'md';
		/** Shows a small remove button. */
		onremove?: () => void;
		title?: string;
		children?: Snippet;
	}

	let {
		color = 'default',
		label,
		icon,
		dot = false,
		size = 'md',
		onremove,
		title,
		children
	}: Props = $props();
</script>

<span class="tag {color} {size}" class:has-dot={dot} {title}>
	{#if dot}<span class="dot" aria-hidden="true"></span>{/if}
	{#if icon}<Icon name={icon} size={12} />{/if}
	<span class="text"
		>{#if children}{@render children()}{:else}{label}{/if}</span
	>
	{#if onremove}
		<button type="button" class="rm" aria-label="Remove {label ?? ''}" onclick={onremove}>
			<Icon name="x" size={10} strokeWidth={2} />
		</button>
	{/if}
</span>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		max-width: 100%;
		padding: 0 6px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		line-height: 120%;
		font-weight: 400;
		white-space: nowrap;
		vertical-align: middle;
		flex: none;
	}
	.tag.sm {
		height: 18px;
		font-size: 12px;
		padding: 0 5px;
	}
	.tag.has-dot {
		border-radius: 10px;
		padding: 0 8px 0 7px;
		gap: 5px;
	}
	.text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
		background: var(--c-dot);
	}
	.rm {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		margin-right: -3px;
		padding: 0;
		border: 0;
		border-radius: 2px;
		background: transparent;
		color: inherit;
		opacity: 0.5;
	}
	.rm:hover {
		opacity: 1;
		background: rgba(0, 0, 0, 0.08);
	}

	.default {
		background: rgba(206, 205, 202, 0.5);
		color: var(--text);
		--c-dot: var(--dot-gray);
	}
	.gray {
		background: var(--tag-gray-bg);
		color: var(--tag-gray-text);
		--c-dot: var(--dot-gray);
	}
	.brown {
		background: var(--tag-brown-bg);
		color: var(--tag-brown-text);
		--c-dot: var(--dot-brown);
	}
	.orange {
		background: var(--tag-orange-bg);
		color: var(--tag-orange-text);
		--c-dot: var(--dot-orange);
	}
	.yellow {
		background: var(--tag-yellow-bg);
		color: var(--tag-yellow-text);
		--c-dot: var(--dot-yellow);
	}
	.green {
		background: var(--tag-green-bg);
		color: var(--tag-green-text);
		--c-dot: var(--dot-green);
	}
	.blue {
		background: var(--tag-blue-bg);
		color: var(--tag-blue-text);
		--c-dot: var(--dot-blue);
	}
	.purple {
		background: var(--tag-purple-bg);
		color: var(--tag-purple-text);
		--c-dot: var(--dot-purple);
	}
	.pink {
		background: var(--tag-pink-bg);
		color: var(--tag-pink-text);
		--c-dot: var(--dot-pink);
	}
	.red {
		background: var(--tag-red-bg);
		color: var(--tag-red-text);
		--c-dot: var(--dot-red);
	}
</style>
