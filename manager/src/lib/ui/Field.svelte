<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		id: string;
		label?: string;
		hint?: string;
		error?: string | null;
		/** Set when the control itself renders the label (e.g. checkboxes). */
		children: Snippet;
		class?: ClassValue | null;
	}

	let { id, label, hint, error, children, class: klass = '' }: Props = $props();
</script>

<div class={['field', klass]}>
	{#if label}<label class="label" for={id}>{label}</label>{/if}
	{@render children()}
	{#if error}
		<p class="error" id="{id}-error" role="alert">{error}</p>
	{:else if hint}
		<p class="hint" id="{id}-hint">{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
		line-height: 16px;
	}
	.hint,
	.error {
		font-size: 12px;
		line-height: 16px;
		color: var(--text-tertiary);
	}
	.error {
		color: var(--danger-text);
	}
</style>
