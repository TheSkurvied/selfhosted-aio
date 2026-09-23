<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Button,
		Callout,
		CodeEditor,
		CopyButton,
		EmptyState,
		Icon,
		JsonView,
		Menu,
		Select,
		Spinner,
		StatusTag
	} from '$lib/ui';
	import type { PageData } from './$types';
	import { Busy, submitter } from '../../_lib/forms.svelte';
	import { KIND_LABEL, fmtDate, fmtDateTime, fmtRelative, shortId } from '../../_lib/format';

	type Kind = 'aiostreams' | 'aiometadata';
	type Binding = NonNullable<PageData['person']['bindings'][Kind]>;
	type Tpl = PageData['templates'][number];
	type PreviewResult = Awaited<NonNullable<PageData['previews'][Kind]>>;

	interface Props {
		kind: Kind;
		binding: Binding | null;
		templates: Tpl[];
		preview?: Promise<PreviewResult>;
		busy: Busy;
		personDisabled: boolean;
		ondiff: (kind: Kind) => void;
		onconfirm: (kind: Kind, what: 'rotate' | 'remove' | 'adopt') => void;
	}
	let { kind, binding, templates, preview, busy, personDisabled, ondiff, onconfirm }: Props =
		$props();

	const label = $derived(KIND_LABEL[kind]);
	const k = (s: string) => `${s}-${kind}`;

	// Editable state; reset whenever the server data changes (writable deriveds).
	let templateId = $derived(binding?.templateId ?? templates[0]?.id ?? '');
	let version = $derived(binding?.pinnedVersionId ?? 'latest');
	let overrides = $derived(binding ? JSON.stringify(binding.overrides ?? {}, null, 2) : '{}');
	let overridesValid = $state(true);

	const savedOverrides = $derived(
		binding ? JSON.stringify(binding.overrides ?? {}, null, 2) : '{}'
	);
	const dirty = $derived(
		!!binding &&
			(templateId !== binding.templateId ||
				version !== (binding.pinnedVersionId ?? 'latest') ||
				normalize(overrides) !== normalize(savedOverrides))
	);

	function normalize(s: string) {
		try {
			return JSON.stringify(JSON.parse(s || '{}'));
		} catch {
			return s;
		}
	}

	const tpl = $derived(templates.find((t) => t.id === templateId));
	const templateOptions = $derived(templates.map((t) => ({ value: t.id, label: t.name })));
	const versionOptions = $derived([
		{ value: 'latest', label: tpl ? `Latest (v${tpl.currentVersion})` : 'Latest' },
		...(tpl?.versions ?? [])
			.toSorted((a, b) => b.version - a.version)
			.map((v) => ({
				value: v.id,
				label: `Pin v${v.version}${v.note ? ` - ${v.note.length > 40 ? v.note.slice(0, 40) + '...' : v.note}` : ''}`
			}))
	]);
	// A pinned version that belongs to another template makes no sense after switching.
	$effect(() => {
		if (version !== 'latest' && tpl && !tpl.versions.some((v) => v.id === version))
			version = 'latest';
	});

	const acct = $derived(binding?.account);
	const missing = $derived(binding?.missingSecrets ?? []);
</script>

<section class="bind" id="binding-{kind}" aria-labelledby="bind-h-{kind}">
	<header class="bh">
		<div class="bt">
			<span class="bic"><Icon name="server" size={18} /></span>
			<h2 id="bind-h-{kind}">{label}</h2>
			<StatusTag status={binding?.status ?? 'unbound'} title={binding?.lastError} />
		</div>
		{#if binding}
			<div class="ba">
				<form method="POST" action="?/check" use:enhance={submitter(busy, k('check'))}>
					<input type="hidden" name="kind" value={kind} />
					<Button
						size="sm"
						variant="ghost"
						type="submit"
						icon="refresh"
						loading={busy.is(k('check'))}>Check</Button
					>
				</form>
				<Button
					size="sm"
					variant="ghost"
					icon="code"
					loading={busy.is(k('diff'))}
					disabled={!acct?.remoteUuid}
					onclick={() => ondiff(kind)}>Diff vs remote</Button
				>
				<form method="POST" action="?/push" use:enhance={submitter(busy, k('push'))}>
					<input type="hidden" name="kind" value={kind} />
					<Button
						size="sm"
						variant="primary"
						type="submit"
						icon="upload"
						loading={busy.is(k('push'))}
						disabled={personDisabled || dirty}
						title={dirty ? 'Save your changes first' : undefined}>Push</Button
					>
				</form>
				<Menu
					label="More {label} actions"
					items={[
						{
							label: 'Adopt remote changes',
							icon: 'download',
							disabled: !acct?.remoteUuid,
							onselect: () => onconfirm(kind, 'adopt')
						},
						{
							label: 'Rotate config',
							icon: 'rotate',
							disabled: !acct?.remoteUuid || personDisabled,
							onselect: () => onconfirm(kind, 'rotate')
						},
						{ divider: true },
						{
							label: 'Remove binding',
							icon: 'trash',
							danger: true,
							onselect: () => onconfirm(kind, 'remove')
						}
					]}
				/>
			</div>
		{/if}
	</header>

	{#if binding}
		<dl class="meta">
			<div>
				<dt>Remote uuid</dt>
				<dd class="mono" title={acct?.remoteUuid ?? undefined}>
					{#if acct?.remoteUuid}{shortId(acct.remoteUuid)}
						<CopyButton
							value={acct.remoteUuid}
							size="sm"
							ariaLabel="Copy uuid"
							copiedMessage="uuid copied"
						/>
					{:else}<span class="faint">Not created yet</span>{/if}
				</dd>
			</div>
			<div>
				<dt>Created</dt>
				<dd>{acct ? fmtDate(acct.createdAt) : '-'}</dd>
			</div>
			<div>
				<dt>Last push</dt>
				<dd title={acct?.lastPushAt ? fmtDateTime(acct.lastPushAt) : undefined}>
					{fmtRelative(acct?.lastPushAt)}
				</dd>
			</div>
			<div>
				<dt>Last check</dt>
				<dd title={acct?.lastCheckAt ? fmtDateTime(acct.lastCheckAt) : undefined}>
					{fmtRelative(acct?.lastCheckAt)}
				</dd>
			</div>
			<div>
				<dt>Live version</dt>
				<dd>{binding.renderedVersion ? `v${binding.renderedVersion}` : '-'}</dd>
			</div>
		</dl>

		{#if binding.lastError}
			<Callout color="red" title="Last operation failed">{binding.lastError}</Callout>
		{/if}
		{#if binding.status === 'drifted'}
			<Callout color="yellow" title="Changed upstream">
				Someone edited this config outside the manager. Compare it, then push to overwrite or adopt
				the remote changes into the overrides.
				{#snippet actions()}
					<Button size="sm" onclick={() => ondiff(kind)} loading={busy.is(k('diff'))}>Diff</Button>
				{/snippet}
			</Callout>
		{:else if binding.status === 'missing'}
			<Callout color="red" title="Config missing upstream">
				The config was deleted upstream or its password changed. Push to create it again.
			</Callout>
		{/if}
		{#if missing.length}
			<Callout color="yellow" title="Missing secrets">
				Set <span class="mono">{missing.join(', ')}</span> below (or as a shared secret) before pushing.
			</Callout>
		{/if}

		{#if binding.manifestUrl}
			<div class="manifest">
				<span class="ml">Manifest URL</span>
				<code class="mu" title={binding.manifestUrl}>{binding.manifestUrl}</code>
				<CopyButton
					value={binding.manifestUrl}
					size="sm"
					label="Copy"
					copiedMessage="Manifest URL copied"
				/>
			</div>
		{/if}

		<form
			method="POST"
			action="?/saveBinding"
			class="edit"
			use:enhance={submitter(busy, k('save'))}
		>
			<input type="hidden" name="kind" value={kind} />
			<div class="pickers">
				<Select
					name="templateId"
					label="Template"
					options={templateOptions}
					bind:value={templateId}
				/>
				<Select name="version" label="Version" options={versionOptions} bind:value={version} />
			</div>
			<div class="cols">
				<div class="col">
					<CodeEditor
						name="overrides"
						label="Overrides (JSON merge patch)"
						bind:value={overrides}
						bind:valid={overridesValid}
						minLines={6}
						maxHeight={420}
					/>
				</div>
				<div class="col">
					<div class="pv-head">
						<span class="pv-label">Rendered preview</span>
						<span class="faint pv-note"><Icon name="lock" size={12} /> secrets masked</span>
					</div>
					<div class="pv">
						{#if dirty}
							<p class="faint stale">Save to refresh the preview.</p>
						{/if}
						{#if preview}
							{#await preview}
								<div class="pv-loading" role="status"><Spinner size={14} /> Rendering...</div>
							{:then res}
								{#if res.ok}
									<JsonView
										value={res.value.masked}
										maxHeight={400}
										expandDepth={2}
										label="{label} preview"
									/>
									<p class="faint hash mono" title="Desired hash">
										{res.value.desiredHash.slice(0, 12)}
									</p>
								{:else}
									<Callout color="red">{res.error}</Callout>
								{/if}
							{/await}
						{/if}
					</div>
				</div>
			</div>
			<div class="save-row">
				{#if dirty}<span class="faint unsaved">Unsaved changes</span>{/if}
				{#if dirty}
					<Button
						size="sm"
						variant="ghost"
						onclick={() => {
							templateId = binding.templateId;
							version = binding.pinnedVersionId ?? 'latest';
							overrides = savedOverrides;
						}}>Discard</Button
					>
				{/if}
				<Button
					size="sm"
					type="submit"
					variant={dirty ? 'primary' : 'default'}
					disabled={!dirty || !overridesValid}
					loading={busy.is(k('save'))}>Save</Button
				>
			</div>
		</form>
	{:else if templates.length === 0}
		<EmptyState
			compact
			icon="template"
			title="No {label} templates yet"
			description="Create a template first, then bind it here."
		/>
	{:else}
		<form
			method="POST"
			action="?/saveBinding"
			class="bind-new"
			use:enhance={submitter(busy, k('save'))}
		>
			<input type="hidden" name="kind" value={kind} />
			<p class="muted">No {label} config yet. Pick a template to start one.</p>
			<div class="row">
				<Select
					name="templateId"
					aria-label="{label} template"
					options={templateOptions}
					bind:value={templateId}
					size="sm"
				/>
				<input type="hidden" name="version" value="latest" />
				<Button size="sm" type="submit" icon="link" loading={busy.is(k('save'))}
					>Bind template</Button
				>
			</div>
		</form>
	{/if}
</section>

<style>
	.bind {
		margin-top: 40px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.bh {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px 12px;
		flex-wrap: wrap;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--divider);
	}
	.bt {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.bic {
		display: inline-flex;
		color: var(--text-secondary);
	}
	h2 {
		margin: 0;
		font-size: 20px;
	}
	.ba {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}
	.meta {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 8px 16px;
		margin: 0;
		font-size: 14px;
	}
	.meta dt {
		font-size: 12px;
		color: var(--text-tertiary);
		margin-bottom: 2px;
	}
	.meta dd {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		min-height: 24px;
		white-space: nowrap;
	}
	.manifest {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 6px 6px 12px;
		border-radius: var(--radius-lg);
		background: var(--bg-secondary);
		font-size: 13px;
		min-width: 0;
	}
	.ml {
		color: var(--text-secondary);
		flex: none;
	}
	.mu {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 12px;
		background: none;
		padding: 0;
		color: var(--text-secondary);
	}
	.edit {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.pickers {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		max-width: 520px;
	}
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 16px;
	}
	.col {
		min-width: 0;
	}
	.pv-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
		line-height: 16px;
	}
	.pv-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.pv-note {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
	}
	.pv {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 8px 10px;
		min-height: 120px;
	}
	.pv-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.stale {
		font-size: 12px;
		margin: 0 0 6px;
	}
	.hash {
		font-size: 11px;
		margin: 6px 0 0;
		text-align: right;
	}
	.save-row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}
	.unsaved {
		font-size: 13px;
	}
	.bind-new {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.bind-new p {
		margin: 0;
		font-size: 14px;
	}
	@media (max-width: 900px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.meta {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 640px) {
		.meta {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.pickers {
			grid-template-columns: 1fr;
		}
	}
</style>
