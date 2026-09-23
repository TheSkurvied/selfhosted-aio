<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Button,
		Callout,
		EmptyState,
		Input,
		Menu,
		Modal,
		PageChrome,
		PageHeader,
		Table,
		Tag,
		type TableColumn
	} from '$lib/ui';
	import { Busy, submitter } from '../_lib/forms.svelte';
	import { fmtDateTime, fmtRelative, plural } from '../_lib/format';

	let { data } = $props();
	const busy = new Busy();

	const columns: TableColumn[] = [
		{ key: 'name', label: 'Name', icon: 'key', width: '24%' },
		{ key: 'hint', label: 'Value', icon: 'lock', width: '110px' },
		{ key: 'templates', label: 'Used by templates', icon: 'template', hideOnMobile: true },
		{ key: 'people', label: 'People relying', icon: 'people', width: '140px' },
		{ key: 'updated', label: 'Updated', icon: 'clock', width: '130px', hideOnMobile: true },
		{ key: 'actions', label: '', width: '48px', align: 'right' }
	];

	let formOpen = $state(false);
	let editing = $state<string | null>(null);
	let formError = $state<string | null>(null);
	function openForm(name: string | null = null) {
		editing = name;
		formError = null;
		formOpen = true;
	}
	let deleting = $state<(typeof data.secrets)[number] | null>(null);
	let deleteOpen = $state(false);
</script>

<PageChrome title="Secrets">
	{#snippet actions()}
		<Button size="sm" variant="primary" icon="plus" onclick={() => openForm()}>Add shared secret</Button>
	{/snippet}
</PageChrome>

<div class="page-wide">
	<PageHeader
		title="Secrets"
		icon="key"
		meta={data.secrets.length}
		description="Shared secrets fill placeholders for everyone who does not have their own value. Values are encrypted and never shown again; only the last 4 characters are kept visible."
	/>
	<div class="gap"></div>

	<Table {columns} rows={data.secrets} rowKey={(s) => s.name} caption="Shared secrets">
		{#snippet cell(s, col)}
			{#if col.key === 'name'}
				<code class="mono nm">{s.name}</code>
			{:else if col.key === 'hint'}
				<span class="mono faint">{s.hint}</span>
			{:else if col.key === 'templates'}
				{#if s.usedByTemplates.length}
					<span class="tpls">
						{#each s.usedByTemplates as t (t)}<Tag size="sm" color="gray" icon="template">{t}</Tag>{/each}
					</span>
				{:else}
					<span class="faint">Not used</span>
				{/if}
			{:else if col.key === 'people'}
				{#if s.peopleRelying}{plural(s.peopleRelying, 'person', 'people')}{:else}<span class="faint"
						>Nobody</span
					>{/if}
			{:else if col.key === 'updated'}
				<span class="muted" title={fmtDateTime(s.updatedAt)}>{fmtRelative(s.updatedAt)}</span>
			{:else if col.key === 'actions'}
				<Menu
					label="Actions for {s.name}"
					items={[
						{ label: 'Replace value', icon: 'edit', onselect: () => openForm(s.name) },
						{ divider: true },
						{
							label: 'Delete',
							icon: 'trash',
							danger: true,
							onselect: () => {
								deleting = s;
								deleteOpen = true;
							}
						}
					]}
				/>
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="key"
				title="No shared secrets"
				description="Add one for keys everyone shares, such as a TMDB API key. Per-person keys go on each person's page."
			>
				{#snippet action()}
					<Button variant="primary" icon="plus" onclick={() => openForm()}>Add shared secret</Button>
				{/snippet}
			</EmptyState>
		{/snippet}
	</Table>
</div>

<Modal
	bind:open={formOpen}
	title={editing ? `Replace ${editing}` : 'Add shared secret'}
	description="Stored encrypted. Pushes that use it pick up the new value; existing configs change on the next push."
	size="sm"
>
	<form
		id="secret-form"
		class="stack"
		method="POST"
		action="?/set"
		use:enhance={submitter(busy, 'set', {
			reset: true,
			onsuccess: () => (formOpen = false),
			onfailure: (m) => (formError = m)
		})}
	>
		{#if formError}<Callout color="red">{formError}</Callout>{/if}
		{#if editing}
			<input type="hidden" name="name" value={editing} />
		{:else}
			<Input
				name="name"
				label="Name"
				mono
				required
				placeholder="tmdb_api_key"
				hint="Used in templates as {'{{'}secret:name{'}}'}"
				autocomplete="off"
			/>
		{/if}
		<Input name="value" type="password" label="Value" required autocomplete="new-password" spellcheck="false" />
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (formOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="secret-form" loading={busy.is('set')}>Save</Button>
	{/snippet}
</Modal>

<Modal bind:open={deleteOpen} title="Delete {deleting?.name}?" size="sm">
	{#if deleting}
		{#if deleting.peopleRelying}
			<Callout color="yellow">
				{plural(deleting.peopleRelying, 'person relies', 'people rely')} on this secret. Their pushes fail
				until they get their own value or the secret is added again.
			</Callout>
		{:else}
			<p class="small">Nobody relies on this secret right now.</p>
		{/if}
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (deleteOpen = false)}>Cancel</Button>
		<form
			method="POST"
			action="?/delete"
			use:enhance={submitter(busy, 'delete', { onsuccess: () => (deleteOpen = false) })}
		>
			<input type="hidden" name="name" value={deleting?.name ?? ''} />
			<Button type="submit" variant="danger" loading={busy.is('delete')}>Delete</Button>
		</form>
	{/snippet}
</Modal>

<style>
	.gap {
		height: 16px;
	}
	.nm {
		font-size: 13px;
		background: none;
		padding: 0;
		font-weight: 500;
	}
	.tpls {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.small {
		font-size: 14px;
		margin: 0;
	}
</style>
