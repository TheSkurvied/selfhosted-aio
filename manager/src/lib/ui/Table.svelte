<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/icons/Icon.svelte';
	import Checkbox from './Checkbox.svelte';
	import type { TableColumn } from './types';

	interface Props {
		/** Data mode: column definitions. Omit (and pass `children`) for raw <thead>/<tbody> markup. */
		columns?: TableColumn[];
		rows?: T[];
		/** Unique key per row (required for selection). */
		rowKey?: (row: T) => string;
		/** Custom cell renderer. Default prints `row[column.key]`. */
		cell?: Snippet<[row: T, column: TableColumn]>;
		/** Makes rows clickable; the first cell becomes a real link for keyboard users. */
		rowHref?: (row: T) => string;
		/** Adds a checkbox column. Bind to get the selected row keys. */
		selectable?: boolean;
		selected?: string[];
		/** Rendered when `rows` is empty. */
		empty?: Snippet;
		/** Rendered under the last row, e.g. a "New" row or counts. */
		footer?: Snippet;
		/** Raw mode content: your own <thead>/<tbody>. Styles still apply. */
		children?: Snippet;
		/** Accessible caption (visually hidden). */
		caption?: string;
		/** Sticky header offset; default sits under the 45px top bar. */
		stickyTop?: string;
	}

	let {
		columns,
		rows = [],
		rowKey,
		cell,
		rowHref,
		selectable = false,
		selected = $bindable([]),
		empty,
		footer,
		children,
		caption,
		stickyTop = 'var(--topbar-height)'
	}: Props = $props();

	const keyOf = (row: T, i: number) => (rowKey ? rowKey(row) : String(i));
	const allKeys = $derived(rows.map((r, i) => keyOf(r, i)));
	const allSelected = $derived(allKeys.length > 0 && allKeys.every((k) => selected.includes(k)));
	const someSelected = $derived(!allSelected && allKeys.some((k) => selected.includes(k)));

	function toggleAll() {
		selected = allSelected ? [] : [...allKeys];
	}
	function toggle(k: string) {
		selected = selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k];
	}

	function onRowClick(e: MouseEvent, row: T) {
		if (!rowHref) return;
		const target = e.target as HTMLElement;
		if (target.closest('a, button, input, select, textarea, label, [role="menu"]')) return;
		const href = rowHref(row);
		if (e.metaKey || e.ctrlKey) window.open(href, '_blank');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- consumers pass app paths
		else goto(href);
	}

	function valueOf(row: T, key: string): unknown {
		return (row as Record<string, unknown>)[key];
	}
</script>

<div class="tbl-wrap">
	<table class="tbl" style:--sticky-top={stickyTop}>
		{#if caption}<caption class="sr-only">{caption}</caption>{/if}
		{#if columns}
			<thead>
				<tr>
					{#if selectable}
						<th class="sel-col">
							<Checkbox
								checked={allSelected}
								indeterminate={someSelected}
								onchange={toggleAll}
								aria-label="Select all rows"
							/>
						</th>
					{/if}
					{#each columns as col (col.key)}
						<th
							style:width={col.width}
							style:text-align={col.align}
							class:hide-m={col.hideOnMobile}
							scope="col"
						>
							<span class="th">
								{#if col.icon}<Icon name={col.icon} size={14} />{/if}
								{col.label}
							</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row, i (keyOf(row, i))}
					{@const k = keyOf(row, i)}
					<tr
						class:clickable={!!rowHref}
						class:selected={selectable && selected.includes(k)}
						onclick={(e) => onRowClick(e, row)}
					>
						{#if selectable}
							<td class="sel-col">
								<Checkbox
									checked={selected.includes(k)}
									onchange={() => toggle(k)}
									aria-label="Select row"
								/>
							</td>
						{/if}
						{#each columns as col, ci (col.key)}
							<td
								style:text-align={col.align}
								class:hide-m={col.hideOnMobile}
								class:first={ci === 0}
							>
								{#if ci === 0 && rowHref}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- consumers pass app paths -->
									<a class="row-link" href={rowHref(row)}>
										{#if cell}{@render cell(row, col)}{:else}{valueOf(row, col.key) ?? ''}{/if}
									</a>
								{:else if cell}
									{@render cell(row, col)}
								{:else}
									{valueOf(row, col.key) ?? ''}
								{/if}
							</td>
						{/each}
					</tr>
				{:else}
					<tr class="empty-row">
						<td colspan={columns.length + (selectable ? 1 : 0)}>
							{#if empty}{@render empty()}{:else}<span class="no-rows">No rows</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		{:else if children}
			{@render children()}
		{/if}
	</table>
	{#if footer}<div class="tbl-footer">{@render footer()}</div>{/if}
</div>

<style>
	/* No overflow on desktop so the header can stick to the window scroll. */
	.tbl-wrap {
		width: 100%;
		border-top: 1px solid var(--divider);
	}
	.tbl {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 14px;
		line-height: 1.5;
	}
	.tbl :global(th) {
		position: sticky;
		top: var(--sticky-top);
		z-index: 2;
		height: 33px;
		padding: 0 8px;
		background: var(--bg);
		border-bottom: 1px solid var(--divider);
		color: var(--text-secondary);
		font-weight: 400;
		font-size: 14px;
		text-align: left;
		white-space: nowrap;
	}
	.tbl :global(th + th),
	.tbl :global(td + td) {
		border-left: 1px solid var(--divider);
	}
	.th {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.th :global(svg) {
		color: var(--text-tertiary);
	}
	.tbl :global(td) {
		height: 34px;
		padding: 5px 8px;
		border-bottom: 1px solid var(--divider);
		color: var(--text);
		vertical-align: middle;
		white-space: nowrap;
	}
	.tbl :global(tbody tr) {
		transition: background var(--ease);
	}
	.tbl :global(tbody tr:hover) {
		background: var(--bg-hover);
	}
	.tbl :global(tbody tr.empty-row:hover) {
		background: transparent;
	}
	tr.clickable {
		cursor: pointer;
	}
	tr.selected,
	tr.selected:hover {
		background: var(--bg-selected);
	}
	td.first {
		font-weight: 500;
	}
	.row-link {
		color: inherit;
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		vertical-align: middle;
	}
	.row-link:hover {
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
	}
	.sel-col {
		width: 36px;
		padding: 0 8px 0 10px !important;
	}
	.sel-col :global(.cb) {
		opacity: 0;
		transition: opacity var(--ease);
	}
	tr:hover .sel-col :global(.cb),
	tr.selected .sel-col :global(.cb),
	.sel-col :global(.cb:focus-within),
	.sel-col :global(.cb:has(input:checked)),
	.sel-col :global(.cb:has(input:indeterminate)) {
		opacity: 1;
	}
	.empty-row td {
		padding: 0;
	}
	.no-rows {
		display: block;
		padding: 16px 8px;
		color: var(--text-tertiary);
	}
	.tbl-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 34px;
		padding: 4px 8px;
		font-size: 14px;
		color: var(--text-tertiary);
	}
	@media (max-width: 768px) {
		.tbl-wrap {
			overflow-x: auto;
		}
		.tbl :global(th) {
			position: static;
		}
		.hide-m {
			display: none;
		}
		.sel-col :global(.cb) {
			opacity: 1;
		}
	}
</style>
