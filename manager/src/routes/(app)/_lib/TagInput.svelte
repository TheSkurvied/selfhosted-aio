<script lang="ts">
	import { Tag, tagColorFor } from '$lib/ui';

	interface Props {
		value?: string[];
		/** Submits one hidden input per tag under this name. */
		name?: string;
		label?: string;
		suggestions?: string[];
		placeholder?: string;
		/** Called after a tag is added or removed. */
		onchange?: (tags: string[]) => void;
		/** Borderless property-value look. */
		quiet?: boolean;
	}
	let {
		value = $bindable([]),
		name,
		label,
		suggestions = [],
		placeholder = 'Add a tag',
		onchange,
		quiet = false
	}: Props = $props();

	const uid = $props.id();
	let draft = $state('');
	let input: HTMLInputElement | undefined = $state();

	function add(raw: string) {
		const parts = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const next = [...value];
		for (const p of parts) if (!next.includes(p)) next.push(p);
		draft = '';
		if (next.length !== value.length) {
			value = next;
			onchange?.(value);
		}
	}
	function remove(t: string) {
		value = value.filter((x) => x !== t);
		onchange?.(value);
		input?.focus();
	}
	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			if (draft.trim()) {
				e.preventDefault();
				add(draft);
			} else if (e.key === 'Enter' && !name) e.preventDefault();
		} else if (e.key === 'Backspace' && draft === '' && value.length) {
			remove(value[value.length - 1]);
		}
	}
	const options = $derived(suggestions.filter((s) => !value.includes(s)));
</script>

<div class="ti-wrap">
	{#if label}<label class="ti-label" for="ti-{uid}">{label}</label>{/if}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="ti" class:quiet onclick={() => input?.focus()}>
		{#each value as t (t)}
			<Tag color={tagColorFor(t)} size="sm" onremove={() => remove(t)}>{t}</Tag>
			{#if name}<input type="hidden" {name} value={t} />{/if}
		{/each}
		<input
			id="ti-{uid}"
			bind:this={input}
			bind:value={draft}
			{onkeydown}
			onblur={() => draft.trim() && add(draft)}
			list={options.length ? `ti-list-${uid}` : undefined}
			placeholder={value.length ? '' : placeholder}
			aria-label={label ? undefined : 'Tags'}
			autocomplete="off"
		/>
		{#if options.length}
			<datalist id="ti-list-{uid}">
				{#each options as s (s)}<option value={s}></option>{/each}
			</datalist>
		{/if}
	</div>
</div>

<style>
	.ti-wrap {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ti-label {
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
		color: var(--text-secondary);
	}
	.ti {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		padding: 3px 6px;
		border: 1px solid var(--border-input);
		border-radius: var(--radius);
		background: var(--bg-input);
		cursor: text;
	}
	.ti:focus-within {
		box-shadow: var(--focus-ring);
		border-color: var(--accent);
	}
	.ti.quiet {
		border-color: transparent;
		background: transparent;
		padding-left: 4px;
	}
	.ti.quiet:hover {
		background: var(--bg-hover);
	}
	.ti.quiet:focus-within {
		border-color: transparent;
		background: var(--bg-hover);
		box-shadow: none;
	}
	input {
		flex: 1;
		min-width: 80px;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		padding: 2px 2px;
	}
	input::placeholder {
		color: var(--text-tertiary);
	}
</style>
