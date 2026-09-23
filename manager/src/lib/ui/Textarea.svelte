<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import Field from './Field.svelte';

	interface Props extends HTMLTextareaAttributes {
		value?: string | null;
		label?: string;
		hint?: string;
		error?: string | null;
		mono?: boolean;
		/** Grow with content up to maxRows. */
		autosize?: boolean;
		maxRows?: number;
	}

	let {
		value = $bindable(),
		label,
		hint,
		error,
		mono = false,
		autosize = true,
		maxRows = 16,
		rows = 3,
		id,
		class: klass = '',
		...rest
	}: Props = $props();

	const uid = $props.id();
	const taId = $derived(id ?? `ta-${uid}`);
	let el: HTMLTextAreaElement | undefined = $state();

	$effect(() => {
		void value;
		if (!autosize || !el) return;
		el.style.height = 'auto';
		const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
		const max = lh * maxRows + 12;
		el.style.height = Math.min(el.scrollHeight + 2, max) + 'px';
	});
</script>

<Field id={taId} {label} {hint} {error} class={klass}>
	<textarea
		bind:this={el}
		bind:value
		id={taId}
		{rows}
		class:mono
		class:invalid={!!error}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? `${taId}-error` : hint ? `${taId}-hint` : undefined}
		{...rest}></textarea>
</Field>

<style>
	textarea {
		display: block;
		width: 100%;
		padding: 6px 10px;
		border: 0;
		border-radius: var(--radius);
		background: var(--bg-input);
		box-shadow: inset 0 0 0 1px var(--border-input);
		font-size: 14px;
		line-height: 20px;
		color: var(--text);
		resize: vertical;
		transition: box-shadow var(--ease);
	}
	textarea::placeholder {
		color: var(--text-tertiary);
	}
	textarea:focus,
	textarea:focus-visible {
		outline: none;
		border-radius: var(--radius);
		box-shadow:
			inset 0 0 0 1px rgba(35, 131, 226, 0.57),
			var(--focus-ring);
	}
	textarea.invalid {
		box-shadow: inset 0 0 0 1px var(--danger-border);
	}
	textarea.mono {
		font-family: var(--font-mono);
		font-size: 13px;
	}
</style>
