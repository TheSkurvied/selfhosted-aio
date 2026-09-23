<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Button,
		Callout,
		CodeEditor,
		EmptyState,
		Input,
		Menu,
		Modal,
		PageChrome,
		PageHeader,
		Select,
		Table,
		Tag,
		toast,
		type TableColumn
	} from '$lib/ui';
	import ExtractModal from '../_lib/ExtractModal.svelte';
	import { Busy, submitter } from '../_lib/forms.svelte';
	import { KIND_LABEL, fmtRelative, plural } from '../_lib/format';

	let { data } = $props();
	const busy = new Busy();

	const columns: TableColumn[] = [
		{ key: 'name', label: 'Name', icon: 'text', width: '34%' },
		{ key: 'kind', label: 'Service', icon: 'server' },
		{ key: 'version', label: 'Version', icon: 'hash' },
		{ key: 'usedBy', label: 'Used by', icon: 'people' },
		{ key: 'updated', label: 'Updated', icon: 'clock', hideOnMobile: true }
	];

	let newOpen = $state(false);
	let name = $state('');
	let kind = $state<'aiostreams' | 'aiometadata'>('aiostreams');
	let description = $state('');
	let body = $state('{\n  \n}');
	let bodyValid = $state(true);
	let newError = $state<string | null>(null);
	let extractOpen = $state(false);

	function loadStarter(s: (typeof data.starters)[number]) {
		kind = s.kind;
		body = s.body;
		if (!name) name = s.name.replace(/^AIO(Streams|Metadata):\s*/, '');
		if (!description) description = s.description;
		newError = null;
	}
	function openNew() {
		newError = null;
		newOpen = true;
	}
	const needsExtract = $derived(!!newError && newError.includes('Extract secrets'));
</script>

<PageChrome title="Templates">
	{#snippet actions()}
		<Button size="sm" variant="primary" icon="plus" onclick={openNew}>New template</Button>
	{/snippet}
</PageChrome>

<div class="page-wide">
	<PageHeader
		title="Templates"
		icon="template"
		meta={data.templates.length}
		description="Shared configs that people follow. Secrets live in placeholders like {'{{'}secret:rd_key}}, never in the template."
	/>

	<div class="gap"></div>
	<Table
		{columns}
		rows={data.templates}
		rowKey={(t) => t.id}
		rowHref={(t) => resolve(`/templates/${t.id}`)}
		caption="Templates"
	>
		{#snippet cell(t, col)}
			{#if col.key === 'name'}
				<span class="nm">{t.name}</span>
				{#if t.description}<span class="desc faint">{t.description}</span>{/if}
			{:else if col.key === 'kind'}
				<Tag size="sm" color={t.kind === 'aiostreams' ? 'blue' : 'purple'}>{KIND_LABEL[t.kind]}</Tag
				>
			{:else if col.key === 'version'}
				<span class="mono">v{t.currentVersion}</span>
			{:else if col.key === 'usedBy'}
				{#if t.usedBy}{plural(t.usedBy, 'person', 'people')}{:else}<span class="faint">Unused</span
					>{/if}
			{:else if col.key === 'updated'}
				<span class="muted">{fmtRelative(t.updatedAt)}</span>
			{/if}
		{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="template"
				title="No templates yet"
				description="Start from a starter template or paste an export from AIOStreams or AIOMetadata."
			>
				{#snippet action()}
					<div class="row">
						<Button variant="primary" icon="plus" onclick={openNew}>New template</Button>
						<form method="POST" action="?/seed" use:enhance={submitter(busy, 'seed')}>
							<Button type="submit" icon="download" loading={busy.is('seed')}
								>Add starter templates</Button
							>
						</form>
					</div>
				{/snippet}
			</EmptyState>
		{/snippet}
	</Table>
</div>

<Modal
	bind:open={newOpen}
	title="New template"
	description="Paste an exported config or start from a starter. You can edit it after creating."
	size="lg"
>
	<form
		id="new-template"
		class="stack"
		method="POST"
		action="?/create"
		use:enhance={submitter(busy, 'create', { onfailure: (m) => (newError = m) })}
	>
		{#if newError}
			<Callout color={needsExtract ? 'yellow' : 'red'}>
				{newError}
				{#snippet actions()}
					{#if needsExtract}
						<Button size="sm" icon="key" onclick={() => (extractOpen = true)}
							>Extract secrets</Button
						>
					{/if}
				{/snippet}
			</Callout>
		{/if}
		<div class="grid2">
			<Input
				name="name"
				label="Name"
				bind:value={name}
				required
				autocomplete="off"
				placeholder="Family"
			/>
			<Select
				name="kind"
				label="Service"
				bind:value={kind}
				options={[
					{ value: 'aiostreams', label: 'AIOStreams' },
					{ value: 'aiometadata', label: 'AIOMetadata' }
				]}
			/>
		</div>
		<Input name="description" label="Description" bind:value={description} placeholder="Optional" />
		<div class="body-head">
			<span class="lbl">Body (JSON)</span>
			<div class="row">
				<Button
					size="sm"
					variant="ghost"
					icon="key"
					onclick={() => (extractOpen = true)}
					disabled={!bodyValid}>Extract secrets</Button
				>
				<Menu
					label="Load starter"
					width={280}
					items={[
						{ heading: 'Starter templates' },
						...data.starters.map((s) => ({
							label: s.name,
							icon: 'file' as const,
							hint: KIND_LABEL[s.kind],
							onselect: () => loadStarter(s)
						}))
					]}
				>
					{#snippet trigger(props)}
						<Button size="sm" variant="ghost" icon="file" iconRight="chevron-down" {...props}
							>Load starter</Button
						>
					{/snippet}
				</Menu>
			</div>
		</div>
		<CodeEditor
			name="body"
			bind:value={body}
			bind:valid={bodyValid}
			minLines={12}
			maxHeight={380}
		/>
		<Input name="note" label="Version note" placeholder="Initial version" />
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (newOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="new-template"
			disabled={!bodyValid}
			loading={busy.is('create')}>Create template</Button
		>
	{/snippet}
</Modal>

<ExtractModal
	bind:open={extractOpen}
	{body}
	onapply={(b, info) => {
		body = b;
		newError = null;
		toast.success(
			`Replaced ${plural(info.replaced, 'value')}${info.saved ? `, saved ${plural(info.saved, 'shared secret')}` : ''}`
		);
	}}
/>

<style>
	.gap {
		height: 16px;
	}
	.nm {
		font-weight: 500;
	}
	.desc {
		margin-left: 8px;
		font-size: 13px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 200px;
		gap: 12px;
	}
	.body-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: -6px;
	}
	.lbl {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	@media (max-width: 640px) {
		.grid2 {
			grid-template-columns: 1fr;
		}
		.desc {
			display: none;
		}
	}
</style>
