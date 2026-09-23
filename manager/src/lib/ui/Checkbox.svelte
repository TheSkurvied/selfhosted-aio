<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Icon from '$lib/icons/Icon.svelte';

	interface Props extends Omit<HTMLInputAttributes, 'type' | 'children'> {
		checked?: boolean;
		indeterminate?: boolean;
		label?: string;
		/** Secondary line under the label. */
		description?: string;
		children?: Snippet;
	}

	let {
		checked = $bindable(false),
		indeterminate = $bindable(false),
		label,
		description,
		children,
		id,
		class: klass = '',
		...rest
	}: Props = $props();

	const uid = $props.id();
	const cbId = $derived(id ?? `cb-${uid}`);
</script>

<label class="cb {klass}" for={cbId} class:bare={!label && !children}>
	<span class="box-wrap">
		<input type="checkbox" id={cbId} bind:checked bind:indeterminate {...rest} />
		<span class="box" aria-hidden="true">
			{#if indeterminate}
				<svg width="12" height="12" viewBox="0 0 12 12"
					><path d="M3 6h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg
				>
			{:else if checked}
				<Icon name="check" size={13} strokeWidth={2.2} />
			{/if}
		</span>
	</span>
	{#if label || children}
		<span class="text">
			{#if children}{@render children()}{:else}{label}{/if}
			{#if description}<span class="desc">{description}</span>{/if}
		</span>
	{/if}
</label>

<style>
	.cb {
		display: inline-flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 14px;
		line-height: 20px;
		cursor: pointer;
		user-select: none;
	}
	.box-wrap {
		position: relative;
		display: inline-flex;
		width: 16px;
		height: 20px;
		align-items: center;
		flex: none;
	}
	input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border-radius: var(--radius-sm);
		box-shadow: inset 0 0 0 1.5px var(--text-secondary);
		color: #fff;
		transition:
			background var(--ease),
			box-shadow var(--ease);
		pointer-events: none;
	}
	.cb:hover .box {
		background: var(--bg-hover);
	}
	input:checked + .box,
	input:indeterminate + .box {
		background: var(--accent);
		box-shadow: none;
	}
	input:focus-visible + .box {
		box-shadow: var(--focus-ring);
	}
	input:disabled + .box {
		opacity: 0.4;
	}
	.text {
		display: flex;
		flex-direction: column;
		color: var(--text);
	}
	.desc {
		font-size: 12px;
		line-height: 16px;
		color: var(--text-secondary);
	}
</style>
