<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button, EmptyState, PageChrome, PageHeader, Select, toast } from '$lib/ui';
	import AuditList from '../_lib/AuditList.svelte';
	import { callAction } from '../_lib/forms.svelte';
	import type { AuditRow } from '../_lib/types';

	let { data } = $props();

	// Rows appended by "Load more"; cleared whenever the filters (load data) change.
	let extra = $state<AuditRow[]>([]);
	let more = $state(false);
	$effect(() => {
		void data.rows;
		extra = [];
		more = data.hasMore;
	});
	const rows = $derived([...data.rows, ...extra]);
	let loading = $state(false);

	async function loadMore() {
		const last = rows[rows.length - 1];
		if (!last) return;
		loading = true;
		try {
			const res = await callAction<{ rows: AuditRow[]; hasMore: boolean }>('?/more', {
				person: data.filters.person,
				action: data.filters.action,
				before: last.id
			});
			extra = [...extra, ...res.rows];
			more = res.hasMore;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not load more');
		} finally {
			loading = false;
		}
	}

	function setParam(key: string, value: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- throwaway copy, not state
		const sp = new URLSearchParams(page.url.searchParams);
		if (value) sp.set(key, value);
		else sp.delete(key);
		const qs = sp.toString();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, query only
		goto(`${resolve('/audit')}${qs ? `?${qs}` : ''}`, { keepFocus: true, noScroll: true });
	}

	const ACTIONS = [
		{ value: '', label: 'All actions' },
		{ value: 'person', label: 'People' },
		{ value: 'binding', label: 'Bindings' },
		{ value: 'push', label: 'Pushes' },
		{ value: 'bulk', label: 'Bulk actions' },
		{ value: 'template', label: 'Templates' },
		{ value: 'secret', label: 'Secrets' },
		{ value: 'share', label: 'Share links' },
		{ value: 'import', label: 'Imports' },
		{ value: 'account', label: 'Upstream accounts' },
		{ value: 'auth', label: 'Sign-ins' },
		{ value: 'admin', label: 'Admins' }
	];
	const personOptions = $derived([
		{ value: '', label: 'Everyone' },
		...data.people.map((p) => ({ value: p.id, label: p.name }))
	]);
	const filtered = $derived(!!(data.filters.person || data.filters.action));
</script>

<PageChrome title="Audit log" />

<div class="page-wide">
	<PageHeader
		title="Audit log"
		icon="audit"
		description="Every change made by an admin or by the manager itself. Secret values are never recorded, only which paths changed."
	/>

	<div class="toolbar" role="toolbar" aria-label="Filter audit log">
		<Select
			size="sm"
			quiet
			aria-label="Filter by action"
			options={ACTIONS}
			value={data.filters.action}
			onchange={(e) => setParam('action', e.currentTarget.value)}
		/>
		<Select
			size="sm"
			quiet
			aria-label="Filter by person"
			options={personOptions}
			value={data.filters.person}
			onchange={(e) => setParam('person', e.currentTarget.value)}
		/>
		{#if filtered}
			<Button
				size="sm"
				variant="ghost"
				icon="x"
				onclick={() => {
					goto(resolve('/audit'), { keepFocus: true, noScroll: true });
				}}>Clear filters</Button
			>
		{/if}
	</div>

	<AuditList {rows}>
		{#snippet empty()}
			<EmptyState
				icon="audit"
				title={filtered ? 'No matching entries' : 'Nothing recorded yet'}
				description={filtered
					? 'Try another action or person.'
					: 'Changes made here show up in this log.'}
			/>
		{/snippet}
	</AuditList>

	{#if more}
		<div class="more">
			<Button size="sm" variant="ghost" icon="chevron-down" {loading} onclick={loadMore}
				>Load more</Button
			>
		</div>
	{:else if rows.length > 20}
		<p class="faint end">End of the log</p>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin: 8px 0 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--divider);
	}
	.more {
		display: flex;
		justify-content: center;
		margin-top: 12px;
	}
	.end {
		text-align: center;
		font-size: 13px;
		margin-top: 16px;
	}
</style>
