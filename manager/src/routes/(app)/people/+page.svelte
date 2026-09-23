<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		Button,
		Callout,
		Checkbox,
		EmptyState,
		Icon,
		Input,
		Menu,
		Modal,
		PageChrome,
		PageHeader,
		Select,
		Spinner,
		StatusTag,
		Table,
		Tag,
		Textarea,
		tagColorFor,
		type TableColumn,
		SYNC_STATUS,
		type SyncStatus
	} from '$lib/ui';
	import TagInput from '../_lib/TagInput.svelte';
	import { Busy, callAction, submitter } from '../_lib/forms.svelte';
	import { KIND_LABEL, fmtDate } from '../_lib/format';

	let { data } = $props();

	type Person = (typeof data.people)[number];
	type Kind = 'aiostreams' | 'aiometadata';

	const busy = new Busy();
	let selected = $state<string[]>([]);
	// Drop selections that are no longer visible after a filter change.
	$effect(() => {
		const visible = new Set(data.people.map((p) => p.id));
		if (selected.some((id) => !visible.has(id)))
			selected = selected.filter((id) => visible.has(id));
	});

	const columns: TableColumn[] = [
		{ key: 'name', label: 'Name', icon: 'text', width: '28%' },
		{ key: 'tags', label: 'Tags', icon: 'list', width: '18%', hideOnMobile: true },
		{ key: 'aiostreams', label: 'Streams', icon: 'server' },
		{ key: 'aiometadata', label: 'Metadata', icon: 'server', hideOnMobile: true }
	];

	// ---- filters (URL driven)
	let q = $state(page.url.searchParams.get('q') ?? '');
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function setParam(key: string, value: string) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- throwaway copy, not state
		const sp = new URLSearchParams(page.url.searchParams);
		if (value) sp.set(key, value);
		else sp.delete(key);
		const qs = sp.toString();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, query only
		goto(`${resolve('/people')}${qs ? `?${qs}` : ''}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}
	function onsearch(v: string) {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => setParam('q', v.trim()), 250);
	}
	const filtered = $derived(!!(data.filters.q || data.filters.tag || data.filters.status));
	const statusOptions = [
		{ value: '', label: 'Any status' },
		...(Object.keys(SYNC_STATUS) as SyncStatus[]).map((s) => ({
			value: s,
			label: SYNC_STATUS[s].label
		}))
	];
	const tagOptions = $derived([
		{ value: '', label: 'All tags' },
		...data.tags.map((t) => ({ value: t, label: t }))
	]);

	// ---- new person
	let newOpen = $state(false);
	let newTags = $state<string[]>([]);
	let newError = $state<string | null>(null);
	const templatesFor = (k: Kind) => [
		{ value: '', label: 'None for now' },
		...data.templates
			.filter((t) => t.kind === k)
			.map((t) => ({ value: t.id, label: `${t.name} (v${t.currentVersion})` }))
	];

	// ---- import
	let importStreamsOpen = $state(false);
	let importMetaOpen = $state(false);
	let importError = $state<string | null>(null);
	let target = $state<'new' | 'existing'>('new');
	type Candidate = {
		uuid: string;
		createdAt?: string | Date | null;
		lastUpdated?: string | Date | null;
		known: boolean;
		personName?: string;
	};
	let candidates = $state<Candidate[] | null>(null);
	let candidatesError = $state<string | null>(null);
	let pick = $state('');
	let confirmReset = $state(false);

	function openImport(kind: Kind) {
		importError = null;
		target = 'new';
		if (kind === 'aiostreams') importStreamsOpen = true;
		else {
			importMetaOpen = true;
			pick = '';
			confirmReset = false;
			void loadCandidates();
		}
	}
	async function loadCandidates() {
		candidates = null;
		candidatesError = null;
		try {
			const res = await callAction<{ candidates: Candidate[] }>('?/candidates');
			candidates = res.candidates;
		} catch (e) {
			candidatesError = e instanceof Error ? e.message : 'Could not load configurations';
		}
	}
	const personOptions = $derived([
		{ value: '', label: 'Choose a person' },
		...data.people.map((p) => ({ value: p.id, label: p.displayName }))
	]);
	const freeCandidates = $derived((candidates ?? []).filter((c) => !c.known));
	const knownCount = $derived((candidates ?? []).length - freeCandidates.length);

	function bindingText(p: Person, k: Kind) {
		const b = p.bindings[k];
		if (!b) return null;
		return b;
	}
</script>

<PageChrome title="People">
	{#snippet actions()}
		<Menu
			label="Import"
			items={[
				{ heading: 'Import an existing config' },
				{ label: 'From AIOStreams', icon: 'download', onselect: () => openImport('aiostreams') },
				{ label: 'From AIOMetadata', icon: 'download', onselect: () => openImport('aiometadata') }
			]}
		>
			{#snippet trigger(props)}
				<Button size="sm" variant="ghost" icon="download" iconRight="chevron-down" {...props}
					>Import</Button
				>
			{/snippet}
		</Menu>
		<Button size="sm" variant="primary" icon="plus" onclick={() => (newOpen = true)}
			>New person</Button
		>
	{/snippet}
</PageChrome>

<div class="page-wide">
	<PageHeader
		title="People"
		icon="people"
		meta={data.total}
		description="Everyone who gets a Stremio setup. Each person can have one AIOStreams and one AIOMetadata configuration."
	/>

	<div class="toolbar" role="toolbar" aria-label="Filter people">
		{#if selected.length}
			<form
				class="bulkbar"
				method="POST"
				action="?/bulk"
				use:enhance={submitter(busy, 'bulk', { onsuccess: () => (selected = []) })}
			>
				{#each selected as id (id)}<input type="hidden" name="id" value={id} />{/each}
				<span class="sel-count">{selected.length} selected</span>
				<Button
					size="sm"
					type="submit"
					name="op"
					value="push"
					icon="upload"
					loading={busy.is('bulk')}>Push</Button
				>
				<Button
					size="sm"
					type="submit"
					name="op"
					value="check"
					icon="refresh"
					disabled={busy.is('bulk')}>Check</Button
				>
				<Button size="sm" variant="ghost" onclick={() => (selected = [])}>Clear</Button>
			</form>
		{:else}
			<div class="search">
				<Input
					size="sm"
					icon="search"
					type="search"
					placeholder="Search people"
					aria-label="Search people"
					bind:value={q}
					oninput={() => onsearch(q)}
				/>
			</div>
			<Select
				size="sm"
				quiet
				aria-label="Filter by tag"
				options={tagOptions}
				value={data.filters.tag}
				onchange={(e) => setParam('tag', e.currentTarget.value)}
			/>
			<Select
				size="sm"
				quiet
				aria-label="Filter by status"
				options={statusOptions}
				value={data.filters.status}
				onchange={(e) => setParam('status', e.currentTarget.value)}
			/>
			{#if filtered}
				<Button
					size="sm"
					variant="ghost"
					icon="x"
					onclick={() => {
						q = '';

						goto(resolve('/people'), { keepFocus: true, noScroll: true, replaceState: true });
					}}>Clear filters</Button
				>
			{/if}
		{/if}
	</div>

	<Table
		{columns}
		rows={data.people}
		rowKey={(p) => p.id}
		rowHref={(p) => resolve(`/people/${p.id}`)}
		selectable
		bind:selected
		caption="People"
	>
		{#snippet cell(p, col)}
			{#if col.key === 'name'}
				<span class="name">
					<span class="avatar" aria-hidden="true">{p.displayName.charAt(0).toUpperCase()}</span>
					<span class="nm" class:disabled={p.disabled}>{p.displayName}</span>
					{#if p.disabled}<Tag size="sm" color="gray" icon="lock">Disabled</Tag>{/if}
				</span>
			{:else if col.key === 'tags'}
				<span class="tags">
					{#each p.tags as t (t)}<Tag size="sm" color={tagColorFor(t)}>{t}</Tag>{/each}
				</span>
			{:else}
				{@const b = bindingText(p, col.key as Kind)}
				{#if b}
					<span class="bind">
						<StatusTag status={b.status} size="sm" />
						<span class="tpl">{b.templateName}</span>
						<span class="ver faint">v{b.version}</span>
						{#if b.pinned}<span class="pin faint" title="Pinned to v{b.version}"
								><Icon name="pin" size={12} /></span
							>{/if}
					</span>
				{:else}
					<span class="faint">-</span>
				{/if}
			{/if}
		{/snippet}
		{#snippet empty()}
			{#if filtered}
				<EmptyState
					compact
					icon="search"
					title="No matches"
					description="Nobody matches these filters."
				/>
			{:else}
				<EmptyState
					icon="people"
					title="No people yet"
					description="Add someone and bind a template to create their Stremio setup, or import a config that already exists upstream."
				>
					{#snippet action()}
						<div class="row">
							<Button variant="primary" icon="plus" onclick={() => (newOpen = true)}
								>New person</Button
							>
							<Button icon="download" onclick={() => openImport('aiostreams')}>Import</Button>
						</div>
					{/snippet}
				</EmptyState>
			{/if}
		{/snippet}
		{#snippet footer()}
			{#if data.people.length}
				<span class="faint count"
					>{data.people.length}{filtered ? ` of ${data.total}` : ''}
					{data.total === 1 ? 'person' : 'people'}</span
				>
			{/if}
		{/snippet}
	</Table>
</div>

<!-- New person -->
<Modal
	bind:open={newOpen}
	title="New person"
	description="Bind templates now or later. Nothing is pushed until you press Push."
	onclose={() => (newError = null)}
>
	<form
		id="new-person"
		class="stack"
		method="POST"
		action="?/create"
		use:enhance={submitter(busy, 'create', { onfailure: (m) => (newError = m) })}
	>
		{#if newError}<Callout color="red">{newError}</Callout>{/if}
		<Input name="displayName" label="Name" placeholder="Grandma" required autocomplete="off" />
		<TagInput name="tags" label="Tags" bind:value={newTags} suggestions={data.tags} />
		<div class="grid2">
			<Select
				name="template_aiostreams"
				label="AIOStreams template"
				options={templatesFor('aiostreams')}
			/>
			<Select
				name="template_aiometadata"
				label="AIOMetadata template"
				options={templatesFor('aiometadata')}
			/>
		</div>
		<Textarea name="notes" label="Notes" rows={2} placeholder="Optional" />
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (newOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="new-person" loading={busy.is('create')}
			>Create person</Button
		>
	{/snippet}
</Modal>

<!-- Import AIOStreams -->
<Modal
	bind:open={importStreamsOpen}
	title="Import from AIOStreams"
	description="Takes over a config someone already made. You need its uuid and password."
	onclose={() => (importError = null)}
>
	<form
		id="import-streams"
		class="stack"
		method="POST"
		action="?/importStreams"
		use:enhance={submitter(busy, 'importStreams', { onfailure: (m) => (importError = m) })}
	>
		{#if importError}<Callout color="red">{importError}</Callout>{/if}
		<Input
			name="uuid"
			label="Config uuid"
			mono
			required
			autocomplete="off"
			placeholder="3f2c8e1a-..."
		/>
		<Input
			name="password"
			type="password"
			label="Config password"
			required
			autocomplete="new-password"
			hint="Stored encrypted. It is never shown again."
		/>
		{@render targetFields('aiostreams')}
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (importStreamsOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="import-streams" loading={busy.is('importStreams')}
			>Import</Button
		>
	{/snippet}
</Modal>

<!-- Import AIOMetadata -->
<Modal
	bind:open={importMetaOpen}
	title="Import from AIOMetadata"
	size="lg"
	onclose={() => (importError = null)}
>
	<form
		id="import-meta"
		class="stack"
		method="POST"
		action="?/importMetadata"
		use:enhance={submitter(busy, 'importMeta', { onfailure: (m) => (importError = m) })}
	>
		<Callout color="yellow" title="The person's old password stops working">
			To take over an AIOMetadata config the manager resets its password. Anyone who opens the
			AIOMetadata configure page with the old password will be locked out. Installed addons keep
			working.
		</Callout>
		{#if importError}<Callout color="red">{importError}</Callout>{/if}

		<fieldset class="cands">
			<legend>Configuration</legend>
			{#if candidatesError}
				<Callout color="red"
					>{candidatesError}
					{#snippet actions()}<Button size="sm" onclick={loadCandidates}>Retry</Button>{/snippet}
				</Callout>
			{:else if candidates === null}
				<div class="loading" role="status"><Spinner size={14} /> Loading configurations...</div>
			{:else if freeCandidates.length === 0}
				<EmptyState
					compact
					icon="database"
					title="Nothing to import"
					description={knownCount
						? `All ${knownCount} AIOMetadata configurations are already managed.`
						: 'AIOMetadata has no configurations yet.'}
				/>
			{:else}
				<ul class="cand-list">
					{#each freeCandidates as c (c.uuid)}
						<li>
							<label class="cand" class:on={pick === c.uuid}>
								<input type="radio" name="uuid" value={c.uuid} bind:group={pick} />
								<span class="mono uuid">{c.uuid}</span>
								<span class="faint when"
									>created {fmtDate(c.createdAt)} · updated {fmtDate(c.lastUpdated)}</span
								>
							</label>
						</li>
					{/each}
				</ul>
				{#if knownCount}<p class="faint small">
						{knownCount} already managed configuration{knownCount === 1 ? '' : 's'} hidden.
					</p>{/if}
			{/if}
		</fieldset>

		{@render targetFields('aiometadata')}
		<Checkbox
			name="confirm"
			bind:checked={confirmReset}
			label="I understand the old AIOMetadata password will stop working"
		/>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (importMetaOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="import-meta"
			disabled={!pick || !confirmReset}
			loading={busy.is('importMeta')}>Reset password and import</Button
		>
	{/snippet}
</Modal>

{#snippet targetFields(kind: Kind)}
	<fieldset class="target">
		<legend>Import into</legend>
		<div class="seg" role="radiogroup" aria-label="Import into">
			<label class:on={target === 'new'}
				><input type="radio" bind:group={target} value="new" /> New person</label
			>
			<label class:on={target === 'existing'}
				><input type="radio" bind:group={target} value="existing" disabled={!data.people.length} /> Existing
				person</label
			>
		</div>
		{#if target === 'new'}
			<Input name="displayName" label="Name" required autocomplete="off" />
		{:else}
			<Select name="personId" label="Person" options={personOptions} required />
		{/if}
		<Select
			name="templateId"
			label="Template"
			hint="Optional. The imported config becomes this person's overrides on top of the template."
			options={[
				{ value: '', label: 'No template (keep config as is)' },
				...data.templates
					.filter((t) => t.kind === kind)
					.map((t) => ({ value: t.id, label: `${t.name} (v${t.currentVersion})` }))
			]}
		/>
		<p class="faint small">
			{KIND_LABEL[kind]} configs keep their uuid, so installed addons keep working.
		</p>
	</fieldset>
{/snippet}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		min-height: 40px;
		padding: 4px 0 8px;
		margin-top: 8px;
	}
	.search {
		width: 240px;
		max-width: 100%;
	}
	.bulkbar {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.sel-count {
		font-size: 14px;
		font-weight: 500;
		color: var(--accent-text);
		margin-right: 6px;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex: none;
		border-radius: 50%;
		background: var(--tag-gray-bg);
		color: var(--tag-gray-text);
		font-size: 11px;
		font-weight: 600;
	}
	.nm {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nm.disabled {
		color: var(--text-tertiary);
		text-decoration: line-through;
	}
	.tags {
		display: inline-flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.bind {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.tpl {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pin {
		display: inline-flex;
	}
	.count {
		font-size: 13px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	legend {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
		padding: 0;
		margin-bottom: 6px;
	}
	.seg {
		display: inline-flex;
		align-self: flex-start;
		padding: 2px;
		border-radius: var(--radius);
		background: var(--bg-hover);
	}
	.seg label {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		border-radius: var(--radius-sm);
		font-size: 14px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.seg label.on {
		background: var(--bg);
		color: var(--text);
		box-shadow: var(--shadow-button);
	}
	.seg label:focus-within {
		box-shadow: var(--focus-ring);
	}
	.seg input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.cand-list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 240px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.cand-list li + li {
		border-top: 1px solid var(--divider);
	}
	.cand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		font-size: 14px;
		cursor: pointer;
		flex-wrap: wrap;
	}
	.cand:hover {
		background: var(--bg-hover);
	}
	.cand.on {
		background: var(--bg-selected);
	}
	.uuid {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.when,
	.small {
		font-size: 12px;
	}
	.small {
		margin: 0;
	}
	.loading {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--text-secondary);
		padding: 8px 0;
	}
	@media (max-width: 640px) {
		.search {
			width: 100%;
		}
		.grid2 {
			grid-template-columns: 1fr;
		}
	}
</style>
