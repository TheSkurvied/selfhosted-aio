<script lang="ts">
	import JsonNode from './JsonNode.svelte';

	interface Props {
		value: unknown;
		/** Property name or array index; omitted for the root. */
		name?: string | number;
		depth: number;
		expandDepth: number;
		last: boolean;
	}

	let { value, name, depth, expandDepth, last }: Props = $props();

	const isArr = $derived(Array.isArray(value));
	const isObj = $derived(value !== null && typeof value === 'object');
	const entries = $derived<[string | number, unknown][]>(
		isArr
			? (value as unknown[]).map((v, i) => [i, v])
			: isObj
				? Object.entries(value as Record<string, unknown>)
				: []
	);
	// svelte-ignore state_referenced_locally
	let open = $state(depth < expandDepth);

	const MASK = /^[•*]{3,}/;
	const PLACEHOLDER = /\{\{\s*secret:[^}]+\}\}/;

	function kind(v: unknown): string {
		if (v === null) return 'null';
		if (typeof v === 'string') return MASK.test(v) ? 'masked' : PLACEHOLDER.test(v) ? 'ph' : 'str';
		return typeof v;
	}
</script>

{#snippet key()}
	{#if name !== undefined}
		{#if typeof name === 'number'}<span class="idx">{name}</span>{:else}<span class="key">"{name}"</span>{/if}<span class="p">: </span>
	{/if}
{/snippet}

{#if isObj}
	<div class="node">
		<button type="button" class="line toggle" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="caret" class:open aria-hidden="true">
				<svg width="8" height="8" viewBox="0 0 10 10"><path d="M3 1.5v7l5-3.5Z" fill="currentColor" /></svg>
			</span>
			{@render key()}<span class="p">{isArr ? '[' : '{'}</span>
			{#if !open}
				<span class="summary">{entries.length} {isArr ? (entries.length === 1 ? 'item' : 'items') : entries.length === 1 ? 'key' : 'keys'}</span><span class="p">{isArr ? ']' : '}'}{last ? '' : ','}</span>
			{:else if entries.length === 0}
				<span class="p">{isArr ? ']' : '}'}{last ? '' : ','}</span>
			{/if}
		</button>
		{#if open && entries.length > 0}
			<div class="children">
				{#each entries as [k, v], i (k)}
					<JsonNode value={v} name={k} depth={depth + 1} {expandDepth} last={i === entries.length - 1} />
				{/each}
			</div>
			<div class="line close"><span class="p">{isArr ? ']' : '}'}{last ? '' : ','}</span></div>
		{/if}
	</div>
{:else}
	{@const k = kind(value)}
	<div class="line leaf">
		{@render key()}<span class="v {k}">{k === 'str' || k === 'masked' || k === 'ph' ? JSON.stringify(value) : String(value)}</span><span class="p">{last ? '' : ','}</span>
	</div>
{/if}

<style>
	.line {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		min-height: 20px;
		padding-left: 14px;
		white-space: pre;
	}
	.toggle {
		position: relative;
		width: 100%;
		border: 0;
		margin: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		border-radius: var(--radius-sm);
	}
	.toggle:hover {
		background: var(--bg-hover);
	}
	.caret {
		position: absolute;
		left: 2px;
		top: 4px;
		display: inline-flex;
		color: var(--text-tertiary);
		transition: transform 120ms ease;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.children {
		margin-left: 18px;
		border-left: 1px solid var(--divider);
	}
	.close {
		padding-left: 14px;
	}
	.leaf {
		white-space: pre-wrap;
		word-break: break-all;
	}
	.key {
		color: var(--text);
	}
	.idx {
		color: var(--text-tertiary);
	}
	.p {
		color: var(--text-tertiary);
	}
	.summary {
		margin: 0 4px;
		padding: 0 4px;
		border-radius: var(--radius-sm);
		background: var(--bg-hover);
		color: var(--text-secondary);
		font-size: 11px;
	}
	.str {
		color: var(--dot-green);
	}
	.number,
	.bigint {
		color: var(--dot-blue);
	}
	.boolean {
		color: var(--dot-purple);
	}
	.null,
	.undefined {
		color: var(--text-tertiary);
		font-style: italic;
	}
	.masked {
		color: var(--text-tertiary);
		letter-spacing: 0.02em;
	}
	.ph {
		color: var(--dot-orange);
		background: var(--callout-yellow);
		border-radius: 2px;
	}
</style>
