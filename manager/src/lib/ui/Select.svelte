<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import Icon from '$lib/icons/Icon.svelte';
	import Field from './Field.svelte';

	export interface SelectOption {
		value: string;
		label: string;
		disabled?: boolean;
	}

	interface Props extends Omit<HTMLSelectAttributes, 'size'> {
		value?: string | null;
		options: Array<SelectOption | string>;
		label?: string;
		hint?: string;
		error?: string | null;
		/** Adds a first, empty option with this text. */
		placeholder?: string;
		size?: 'sm' | 'md';
		/** Borderless, Notion property-value look (hover background only). */
		quiet?: boolean;
	}

	let {
		value = $bindable(),
		options,
		label,
		hint,
		error,
		placeholder,
		size = 'md',
		quiet = false,
		id,
		class: klass = '',
		...rest
	}: Props = $props();

	const uid = $props.id();
	const selId = $derived(id ?? `sel-${uid}`);
	const opts = $derived(
		options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)) as SelectOption[]
	);
</script>

<Field id={selId} {label} {hint} {error} class={klass}>
	<div class="wrap {size}" class:quiet class:invalid={!!error}>
		<select
			bind:value
			id={selId}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? `${selId}-error` : hint ? `${selId}-hint` : undefined}
			{...rest}
		>
			{#if placeholder !== undefined}<option value="">{placeholder}</option>{/if}
			{#each opts as o (o.value)}
				<option value={o.value} disabled={o.disabled}>{o.label}</option>
			{/each}
		</select>
		<span class="chev"><Icon name="chevron-down" size={14} /></span>
	</div>
</Field>

<style>
	.wrap {
		position: relative;
		display: flex;
		height: 32px;
		border-radius: var(--radius);
		background: var(--bg-input);
		box-shadow: inset 0 0 0 1px var(--border-input);
		transition:
			box-shadow var(--ease),
			background var(--ease);
	}
	.wrap.sm {
		height: 28px;
	}
	.wrap.quiet {
		background: transparent;
		box-shadow: none;
	}
	.wrap.quiet:hover {
		background: var(--bg-hover);
	}
	.wrap:focus-within {
		box-shadow:
			inset 0 0 0 1px rgba(35, 131, 226, 0.57),
			var(--focus-ring);
	}
	.wrap.invalid {
		box-shadow: inset 0 0 0 1px var(--danger-border);
	}
	select {
		appearance: none;
		-webkit-appearance: none;
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0 28px 0 10px;
		border: 0;
		background: transparent;
		font-size: 14px;
		color: var(--text);
		cursor: pointer;
	}
	.quiet select {
		padding-left: 6px;
	}
	select:focus,
	select:focus-visible {
		outline: none;
		box-shadow: none;
	}
	select:disabled {
		color: var(--text-tertiary);
		cursor: not-allowed;
	}
	select option {
		background: var(--bg-elevated);
		color: var(--text);
	}
	.chev {
		position: absolute;
		right: 8px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		color: var(--text-tertiary);
		pointer-events: none;
	}
</style>
