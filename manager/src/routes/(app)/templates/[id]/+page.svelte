<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Button,
		Callout,
		CodeEditor,
		Input,
		JsonView,
		Menu,
		Modal,
		PageChrome,
		PageHeader,
		ProgressBar,
		Property,
		PropertyList,
		Tag,
		Textarea,
		toast
	} from '$lib/ui';
	import ExtractModal from '../../_lib/ExtractModal.svelte';
	import JobStatusTag from '../../_lib/JobStatusTag.svelte';
	import { LiveJobs } from '../../_lib/live-jobs.svelte';
	import { Busy, callAction, submitter } from '../../_lib/forms.svelte';
	import { KIND_LABEL, fmtDate, fmtRelative, plural } from '../../_lib/format';
	import type { JobRow } from '../../_lib/types';

	let { data } = $props();
	const tpl = $derived(data.template);
	const busy = new Busy();

	// ---- editor
	const saved = $derived(JSON.stringify(tpl.current.body, null, 2));
	let draft = $derived(saved);
	let valid = $state(true);
	let note = $state('');
	function normalize(s: string) {
		try {
			return JSON.stringify(JSON.parse(s));
		} catch {
			return s;
		}
	}
	const dirty = $derived(normalize(draft) !== normalize(saved));
	const nextVersion = $derived(Math.max(...tpl.versions.map((v) => v.version), 0) + 1);

	type Validation = { ok: boolean; errors: string[]; rawSecrets: number };
	let validation = $state<Validation | null>(null);
	let validatedFor = $state('');
	const showValidation = $derived(validation && validatedFor === draft ? validation : null);
	async function validate() {
		busy.start('validate');
		try {
			const res = await callAction<{ validation: Validation }>('?/validate', { body: draft });
			validation = res.validation;
			validatedFor = draft;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Validation failed');
		} finally {
			busy.stop('validate');
		}
	}
	let extractOpen = $state(false);
	let saveError = $state<string | null>(null);

	// ---- versions
	type VersionView = {
		id: string;
		version: number;
		note: string | null;
		requiredSecrets: string[];
		body: object;
	};
	let viewOpen = $state(false);
	let viewing = $state<VersionView | null>(null);
	async function viewVersion(id: string) {
		busy.start(`v-${id}`);
		try {
			const res = await callAction<{ version: VersionView }>('?/version', { versionId: id });
			viewing = res.version;
			viewOpen = true;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not load version');
		} finally {
			busy.stop(`v-${id}`);
		}
	}

	// ---- rollout: dry run -> push -> live progress
	type DryRow = {
		personId: string;
		displayName: string;
		kind: string;
		willChange: boolean;
		missingSecrets: string[];
	};
	let dryRun = $state<DryRow[] | null>(null);
	let justSaved = $state<number | null>(null);
	let rolloutJobs = $state<string[]>([]);
	let jobState = $state<Record<string, JobRow>>({});
	const willChange = $derived((dryRun ?? []).filter((r) => r.willChange));
	const blocked = $derived((dryRun ?? []).filter((r) => r.missingSecrets.length));
	const finished = $derived(
		rolloutJobs.filter((id) => ['done', 'failed'].includes(jobState[id]?.status ?? '')).length
	);
	const failed = $derived(rolloutJobs.filter((id) => jobState[id]?.status === 'failed').length);

	async function runDry() {
		busy.start('dry');
		try {
			const res = await callAction<{ dryRun: DryRow[] }>('?/dryRun');
			dryRun = res.dryRun;
			rolloutJobs = [];
			jobState = {};
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Dry run failed');
		} finally {
			busy.stop('dry');
		}
	}

	const live = new LiveJobs({
		onjob: (j) => {
			if (rolloutJobs.includes(j.id)) jobState[j.id] = j;
		},
		onpoll: async () => {
			if (!rolloutJobs.length || finished === rolloutJobs.length) return;
			try {
				const res = await fetch('/api/jobs?limit=200');
				if (!res.ok) return;
				const rows = (await res.json()) as JobRow[];
				for (const j of rows) if (rolloutJobs.includes(j.id)) jobState[j.id] = j;
			} catch {
				/* keep the last state */
			}
		}
	});
	onMount(() => live.start());

	const coverageTotal = $derived(tpl.usage.length);
	let metaOpen = $state(false);
	let deleteOpen = $state(false);
	const followers = $derived(tpl.usage.filter((u) => !u.pinned).length);
</script>

<PageChrome
	title={tpl.name}
	crumbs={[
		{ label: 'Templates', href: resolve('/templates'), icon: 'template' },
		{ label: tpl.name }
	]}
>
	{#snippet actions()}
		<Button size="sm" variant="ghost" icon="sync" loading={busy.is('dry')} onclick={runDry}
			>Dry run</Button
		>
		<Menu
			label="Template actions"
			items={[
				{ label: 'Edit name and description', icon: 'edit', onselect: () => (metaOpen = true) },
				{ divider: true },
				{
					label: 'Delete template',
					icon: 'trash',
					danger: true,
					disabled: tpl.usage.length > 0,
					hint: tpl.usage.length ? `In use by ${tpl.usage.length}` : undefined,
					onselect: () => (deleteOpen = true)
				}
			]}
		/>
	{/snippet}
</PageChrome>

<div class="page-wide">
	<PageHeader title={tpl.name} icon="template" description={tpl.description || undefined}>
		<PropertyList>
			<Property label="Service" icon="server">
				<Tag size="sm" color={tpl.kind === 'aiostreams' ? 'blue' : 'purple'}
					>{KIND_LABEL[tpl.kind]}</Tag
				>
			</Property>
			<Property label="Current version" icon="hash">
				<span class="mono">v{tpl.current.version}</span>
				<span class="faint small">
					saved {fmtRelative(tpl.versions.find((v) => v.id === tpl.current.id)?.createdAt)}</span
				>
			</Property>
			<Property label="Used by" icon="people">
				{#if tpl.usage.length}
					{plural(tpl.usage.length, 'person', 'people')}
					<span class="faint small"
						>({followers} follow latest{tpl.usage.length - followers
							? `, ${tpl.usage.length - followers} pinned`
							: ''})</span
					>
				{:else}<span class="faint">Nobody yet</span>{/if}
			</Property>
		</PropertyList>
	</PageHeader>

	<div class="layout">
		<div class="main">
			<form
				id="save-form"
				method="POST"
				action="?/save"
				use:enhance={submitter(busy, 'save', {
					before: () => (saveError = null),
					onfailure: (m) => (saveError = m),
					onsuccess: (d) => {
						note = '';
						justSaved = (d?.saved as number) ?? null;
						if (followers) void runDry();
					}
				})}
			>
				<div class="tools">
					<Button
						size="sm"
						variant="ghost"
						icon="key"
						disabled={!valid}
						onclick={() => (extractOpen = true)}>Extract secrets</Button
					>
					<Button
						size="sm"
						variant="ghost"
						icon="check"
						disabled={!valid}
						loading={busy.is('validate')}
						onclick={validate}>Validate</Button
					>
					<span class="spacer"></span>
					{#if dirty}<span class="faint small">Unsaved changes</span>
						<Button size="sm" variant="ghost" onclick={() => (draft = saved)}>Discard</Button>
					{/if}
				</div>

				{#if saveError}
					<div class="mb">
						<Callout color={saveError.includes('Extract secrets') ? 'yellow' : 'red'}>
							{saveError}
							{#snippet actions()}
								{#if saveError?.includes('Extract secrets')}
									<Button size="sm" icon="key" onclick={() => (extractOpen = true)}
										>Extract secrets</Button
									>
								{/if}
							{/snippet}
						</Callout>
					</div>
				{/if}
				{#if showValidation}
					<div class="mb">
						{#if showValidation.ok && !showValidation.rawSecrets}
							<Callout color="green" title="Looks good"
								>Valid {KIND_LABEL[tpl.kind]} template.</Callout
							>
						{:else}
							<Callout
								color={showValidation.ok ? 'yellow' : 'red'}
								title={showValidation.ok ? 'Valid, but' : 'Not valid'}
							>
								<ul class="errs">
									{#each showValidation.errors as e (e)}<li>{e}</li>{/each}
									{#if showValidation.rawSecrets}
										<li>
											{plural(showValidation.rawSecrets, 'value')} look like raw keys. Extract them into
											placeholders before saving.
										</li>
									{/if}
								</ul>
							</Callout>
						{/if}
					</div>
				{/if}

				<CodeEditor
					name="body"
					label="Body"
					bind:value={draft}
					bind:valid
					minLines={18}
					maxHeight={640}
				/>

				<div class="save-row">
					<div class="note">
						<Input
							name="note"
							bind:value={note}
							placeholder="What changed? (optional)"
							aria-label="Version note"
							size="sm"
						/>
					</div>
					<Button
						type="submit"
						size="sm"
						variant="primary"
						disabled={!dirty || !valid}
						loading={busy.is('save')}>Save as v{nextVersion}</Button
					>
				</div>
			</form>

			{#if dryRun}
				<section class="rollout" aria-labelledby="rollout-h">
					<div class="ro-head">
						<h3 id="rollout-h">
							{#if justSaved}Roll out v{justSaved}{:else}Roll out v{tpl.current.version}{/if}
						</h3>
						<Button
							size="sm"
							variant="ghost"
							icon="x"
							onclick={() => (dryRun = null)}
							aria-label="Close rollout">Close</Button
						>
					</div>
					{#if dryRun.length === 0}
						<p class="muted small">
							Nobody follows the latest version of this template, so there is nothing to push.
						</p>
					{:else}
						<p class="muted small">
							{plural(dryRun.length, 'person', 'people')} follow the latest version. {willChange.length}
							will change{blocked.length
								? `, ${blocked.length} missing secrets (their push will fail)`
								: ''}.
						</p>
						<ul class="dry">
							{#each dryRun as r (r.personId)}
								{@const jid = rolloutJobs.find((id) => jobState[id]?.personName === r.displayName)}
								<li>
									<a href={resolve(`/people/${r.personId}`)}>{r.displayName}</a>
									{#if r.missingSecrets.length}
										<Tag size="sm" color="red" title={r.missingSecrets.join(', ')}
											>Missing {r.missingSecrets.join(', ')}</Tag
										>
									{:else if r.willChange}
										<Tag size="sm" color="yellow" dot>Will change</Tag>
									{:else}
										<Tag size="sm" color="gray">Up to date</Tag>
									{/if}
									<span class="spacer"></span>
									{#if jid && jobState[jid]}<JobStatusTag
											status={jobState[jid].status}
											title={jobState[jid].error ?? undefined}
										/>{/if}
								</li>
							{/each}
						</ul>
						{#if rolloutJobs.length}
							<div class="progress">
								<ProgressBar
									value={finished / rolloutJobs.length}
									color={failed ? 'red' : finished === rolloutJobs.length ? 'green' : 'accent'}
									label="{finished} of {rolloutJobs.length} done{failed
										? `, ${failed} failed`
										: ''}"
									showValue
								/>
							</div>
						{:else}
							<form
								method="POST"
								action="?/push"
								use:enhance={submitter(busy, 'push', {
									onsuccess: (d) => {
										rolloutJobs = (d?.jobIds as string[]) ?? [];
										jobState = {};
									}
								})}
							>
								<Button
									type="submit"
									size="sm"
									variant="primary"
									icon="upload"
									loading={busy.is('push')}
									>Push to {plural(dryRun.length, 'person', 'people')}</Button
								>
							</form>
						{/if}
					{/if}
				</section>
			{/if}
		</div>

		<aside class="side">
			<section>
				<h3>Required secrets</h3>
				{#if tpl.secretCoverage.length === 0}
					<p class="faint small">No placeholders in the current version.</p>
				{:else}
					<ul class="cov">
						{#each tpl.secretCoverage as s (s.name)}
							<li>
								<code class="mono">{s.name}</code>
								{#if s.shared}
									<Tag size="sm" color="purple">Shared</Tag>
								{:else if coverageTotal === 0}
									<span class="faint small">no users</span>
								{:else}
									<Tag size="sm" color={s.peopleNeeding ? 'red' : 'green'}
										>{s.peopleWith}/{coverageTotal} have it</Tag
									>
								{/if}
							</li>
						{/each}
					</ul>
					<a class="side-link" href={resolve('/secrets')}>Manage shared secrets</a>
				{/if}
			</section>

			<section>
				<h3>Used by</h3>
				{#if tpl.usage.length === 0}
					<p class="faint small">Nobody uses this template yet. Bind it from a person's page.</p>
				{:else}
					<ul class="usage">
						{#each tpl.usage as u (u.personId)}
							<li>
								<a href={resolve(`/people/${u.personId}`)}>{u.displayName}</a>
								<span class="faint mono small">v{u.version}</span>
								{#if u.pinned}<Tag size="sm" color="gray" icon="pin">Pinned</Tag>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section>
				<h3>Versions</h3>
				<ul class="versions">
					{#each tpl.versions as v (v.id)}
						<li>
							<button
								type="button"
								class="ver"
								class:current={v.id === tpl.current.id}
								onclick={() => viewVersion(v.id)}
								disabled={busy.is(`v-${v.id}`)}
							>
								<span class="vn mono">v{v.version}</span>
								<span class="vnote">{v.note || 'No note'}</span>
								<span class="vdate faint">{fmtDate(v.createdAt)}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		</aside>
	</div>
</div>

<ExtractModal
	bind:open={extractOpen}
	body={draft}
	onapply={(b, info) => {
		draft = b;
		saveError = null;
		toast.success(
			`Replaced ${plural(info.replaced, 'value')}${info.saved ? `, saved ${plural(info.saved, 'shared secret')}` : ''}`
		);
	}}
/>

<Modal
	bind:open={viewOpen}
	title={viewing ? `${tpl.name} v${viewing.version}` : 'Version'}
	description={viewing?.note || undefined}
	size="lg"
>
	{#if viewing}
		{#if viewing.requiredSecrets.length}
			<p class="faint small">
				Secrets: <span class="mono">{viewing.requiredSecrets.join(', ')}</span>
			</p>
		{/if}
		<JsonView
			value={viewing.body}
			maxHeight={460}
			expandDepth={3}
			label="Version {viewing.version}"
		/>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (viewOpen = false)}>Close</Button>
		{#if viewing && viewing.id !== tpl.current.id}
			<Button
				variant="primary"
				onclick={() => {
					if (viewing) {
						draft = JSON.stringify(viewing.body, null, 2);
						note = `Restore v${viewing.version}`;
					}
					viewOpen = false;
					toast('Loaded into the editor. Save to make it the current version.');
				}}>Load into editor</Button
			>
		{/if}
	{/snippet}
</Modal>

<Modal bind:open={metaOpen} title="Template details" size="sm">
	<form
		id="meta-form"
		class="stack"
		method="POST"
		action="?/meta"
		use:enhance={submitter(busy, 'meta', { onsuccess: () => (metaOpen = false) })}
	>
		<Input name="name" label="Name" value={tpl.name} required autocomplete="off" />
		<Textarea name="description" label="Description" value={tpl.description ?? ''} rows={3} />
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (metaOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="meta-form" loading={busy.is('meta')}>Save</Button>
	{/snippet}
</Modal>

<Modal bind:open={deleteOpen} title="Delete {tpl.name}?" size="sm">
	{#if tpl.usage.length}
		<Callout color="yellow">
			{plural(tpl.usage.length, 'person', 'people')} still use this template. Bind them to another template
			first.
		</Callout>
	{:else}
		<p class="small">
			All {plural(tpl.versions.length, 'version')} are deleted. This cannot be undone.
		</p>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (deleteOpen = false)}>Cancel</Button>
		<form method="POST" action="?/delete" use:enhance={submitter(busy, 'delete')}>
			<Button
				type="submit"
				variant="danger"
				disabled={tpl.usage.length > 0}
				loading={busy.is('delete')}>Delete</Button
			>
		</form>
	{/snippet}
</Modal>

<style>
	.small {
		font-size: 13px;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 40px;
		margin-top: 24px;
		align-items: start;
	}
	.main {
		min-width: 0;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 8px;
		flex-wrap: wrap;
	}
	.spacer {
		flex: 1;
	}
	.mb {
		margin-bottom: 12px;
	}
	.errs {
		margin: 4px 0 0;
		padding-left: 18px;
		font-size: 14px;
	}
	.save-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
	}
	.note {
		flex: 1;
		max-width: 420px;
	}
	.rollout {
		margin-top: 24px;
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--bg-secondary);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.ro-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.rollout h3 {
		margin: 0;
		font-size: 16px;
	}
	.rollout p {
		margin: 0;
	}
	.dry {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 280px;
		overflow: auto;
		font-size: 14px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.dry li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		min-height: 36px;
	}
	.dry li + li {
		border-top: 1px solid var(--divider);
	}
	.dry a,
	.usage a {
		color: var(--text);
		text-decoration: none;
		font-weight: 500;
	}
	.dry a:hover,
	.usage a:hover {
		text-decoration: underline;
	}
	.progress {
		max-width: 420px;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 28px;
		position: sticky;
		top: calc(var(--topbar-height) + 16px);
	}
	.side h3 {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}
	.side ul {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 14px;
	}
	.side p {
		margin: 0;
	}
	.cov li,
	.usage li {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: space-between;
		min-height: 30px;
	}
	.usage li {
		justify-content: flex-start;
	}
	.cov code {
		font-size: 13px;
		background: none;
		color: var(--text);
		padding: 0;
	}
	.side-link {
		display: inline-block;
		margin-top: 6px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.versions li + li {
		margin-top: 1px;
	}
	.ver {
		display: grid;
		grid-template-columns: 36px minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 6px;
		margin: 0 -6px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		box-sizing: content-box;
	}
	.ver:hover {
		background: var(--bg-hover);
	}
	.ver:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.ver.current .vn {
		color: var(--accent-text);
		font-weight: 600;
	}
	.vnote {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.vdate {
		font-size: 12px;
	}
	@media (max-width: 1080px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.side {
			position: static;
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		}
	}
	@media (max-width: 640px) {
		.save-row {
			flex-direction: column;
			align-items: stretch;
		}
		.note {
			max-width: none;
		}
	}
</style>
