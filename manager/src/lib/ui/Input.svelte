<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';
	import Field from './Field.svelte';

	interface Props extends Omit<HTMLInputAttributes, 'size'> {
		value?: string | number | null;
		label?: string;
		hint?: string;
		error?: string | null;
		/** Leading icon inside the field, e.g. 'search'. */
		icon?: IconName;
		size?: 'sm' | 'md' | 'lg';
		mono?: boolean;
		/** Bindable reference to the <input>. */
		ref?: HTMLInputElement | null;
	}

	let {
		value = $bindable(),
		label,
		hint,
		error,
		icon,
		size = 'md',
		mono = false,
		ref = $bindable(null),
		id,
		type = 'text',
		class: klass = '',
		...rest
	}: Props = $props();

	const uid = $props.id();
	const inputId = $derived(id ?? `in-${uid}`);
	const describedBy = $derived(error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined);
</script>

<Field id={inputId} {label} {hint} {error} class={klass}>
	<div class="wrap {size}" class:invalid={!!error} class:has-icon={!!icon}>
		{#if icon}<span class="lead"><Icon name={icon} size={16} /></span>{/if}
		<input
			bind:this={ref}
			bind:value
			id={inputId}
			{type}
			class:mono
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}
			{...rest}
		/>
	</div>
</Field>

<style>
	.wrap {
		position: relative;
		display: flex;
		align-items: center;
		height: 32px;
		border-radius: var(--radius);
		background: var(--bg-input);
		box-shadow: inset 0 0 0 1px var(--border-input);
		transition: box-shadow var(--ease);
	}
	.wrap.sm {
		height: 28px;
	}
	.wrap.lg {
		height: 36px;
	}
	.wrap:focus-within {
		box-shadow:
			inset 0 0 0 1px rgba(35, 131, 226, 0.57),
			var(--focus-ring);
	}
	.wrap.invalid {
		box-shadow: inset 0 0 0 1px var(--danger-border);
	}
	.lead {
		display: inline-flex;
		padding-left: 8px;
		color: var(--text-tertiary);
	}
	input {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0 10px;
		border: 0;
		background: transparent;
		font-size: 14px;
		line-height: 20px;
		color: var(--text);
	}
	.has-icon input {
		padding-left: 6px;
	}
	input::placeholder {
		color: var(--text-tertiary);
	}
	input:focus,
	input:focus-visible {
		outline: none;
		box-shadow: none;
	}
	input:disabled {
		color: var(--text-tertiary);
		cursor: not-allowed;
	}
	input.mono {
		font-family: var(--font-mono);
		font-size: 13px;
	}
</style>
