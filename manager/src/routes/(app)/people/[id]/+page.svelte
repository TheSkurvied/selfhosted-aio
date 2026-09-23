<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidate, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		Button,
		Callout,
		Checkbox,
		CopyButton,
		EmptyState,
		Input,
		JsonView,
		Menu,
		Modal,
		PageChrome,
		PageHeader,
		Property,
		PropertyList,
		Tag,
		Toggle,
		toast,
		type TagColor
	} from '$lib/ui';
	import BindingSection from './BindingSection.svelte';
	import Section from '../../_lib/Section.svelte';
	import AuditList from '../../_lib/AuditList.svelte';
	import TagInput from '../../_lib/TagInput.svelte';
	import { LiveJobs } from '../../_lib/live-jobs.svelte';
	import { Busy, callAction, submitter } from '../../_lib/forms.svelte';
	import { KIND_LABEL, fmtDate, fmtDateTime, fmtRelative } from '../../_lib/format';

	let { data } = $props();

	type Kind = 'aiostreams' | 'aiometadata';
	const KINDS: Kind[] = ['aiostreams', 'aiometadata'];
	const busy = new Busy();
	const person = $derived(data.person);

	// Refresh this page when one of this person's jobs finishes.
	const live = new LiveJobs({
		onpoll: () => {},
		onjob: (j) => {
			if ((j.status === 'done' || j.status === 'failed') && j.personId === person.id) {
				void invalidate('app:person');
				if (j.status === 'failed') toast.error(`${j.type} failed: ${j.error ?? 'unknown error'}`);
			}
		}
	});
	onMount(() => {
		const stop = live.start();
		const sp = page.url.searchParams;
		if (sp.has('created') || sp.has('imported')) {
			toast.success(sp.has('created') ? 'Person created' : 'Config imported');

			replaceState(page.url.pathname, {});
		}
		return stop;
	});

	// ---- properties (autosave)
	let propsForm: HTMLFormElement | undefined = $state();
	let tags = $derived([...person.tags]);
	let notes = $derived(person.notes ?? '');
	let disabled = $derived(person.disabled);
	async function saveProps() {
		await tick();
		propsForm?.requestSubmit();
	}
	const allTagsKnown = $derived(person.tags);

	// ---- rename
	let renameOpen = $state(false);

	// ---- diff
	type Diff = {
		changes: Array<{ path: string; kind: 'added' | 'removed' | 'changed' }>;
		maskedRemote: object;
		maskedDesired: object;
	};
	let diffOpen = $state(false);
	let diffKind = $state<Kind>('aiostreams');
	let diff = $state<Diff | null>(null);
	async function openDiff(kind: Kind) {
		busy.start(`diff-${kind}`);
		try {
			const res = await callAction<{ diff: Diff }>('?/diff', { kind });
			diff = res.diff;
			diffKind = kind;
			diffOpen = true;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Diff failed');
		} finally {
			busy.stop(`diff-${kind}`);
		}
	}
	const CHANGE_COLOR: Record<string, TagColor> = {
		added: 'green',
		removed: 'red',
		changed: 'yellow'
	};

	// ---- confirmations
	let confirm = $state<{ kind: Kind; what: 'rotate' | 'remove' | 'adopt' } | null>(null);
	let confirmOpen = $state(false);
	function onconfirm(kind: Kind, what: 'rotate' | 'remove' | 'adopt') {
		confirm = { kind, what };
		confirmOpen = true;
	}
	let revokeOpen = $state(false);
	let deleteOpen = $state(false);

	// ---- secrets
	type SecretRow = {
		name: string;
		required: boolean;
		satisfiedBy: 'person' | 'shared' | null;
		personHint?: string;
		updatedAt?: Date | string;
	};
	const secretRows = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derived
		const rows = new Map<string, SecretRow>();
		for (const r of person.requiredSecrets)
			rows.set(r.name, { name: r.name, required: true, satisfiedBy: r.satisfiedBy });
		for (const s of person.secrets.filter((s) => s.scope === 'person')) {
			const row = rows.get(s.name) ?? { name: s.name, required: false, satisfiedBy: 'person' };
			row.personHint = s.hint;
			row.updatedAt = s.updatedAt;
			rows.set(s.name, row);
		}
		return [...rows.values()].sort(
			(a, b) => Number(!!a.satisfiedBy) - Number(!!b.satisfiedBy) || a.name.localeCompare(b.name)
		);
	});
	const missingCount = $derived(secretRows.filter((r) => r.required && !r.satisfiedBy).length);
	let secretOpen = $state(false);
	let secretName = $state('');
	let secretFixed = $state(false);
	let secretError = $state<string | null>(null);
	function openSecret(name = '') {
		secretName = name;
		secretFixed = !!name;
		secretError = null;
		secretOpen = true;
	}
	let removeSecret = $state<string | null>(null);
	let removeSecretOpen = $state(false);

	// ---- share links
	let newShareUrl = $state<string | null>(null);
	let shareExpiry = $state('30');
	let shareViews = $state('');
	function tokenState(t: (typeof person.shareTokens)[number]): { label: string; color: TagColor } {
		if (t.revokedAt) return { label: 'Revoked', color: 'gray' };
		if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
			return { label: 'Expired', color: 'orange' };
		if (t.maxViews && t.views >= t.maxViews) return { label: 'Used up', color: 'orange' };
		return { label: 'Active', color: 'green' };
	}
	const activeTokens = $derived(person.shareTokens.filter((t) => tokenState(t).label === 'Active'));
	let showAllTokens = $state(false);
	const visibleTokens = $derived(
		showAllTokens ? person.shareTokens : person.shareTokens.filter((t) => !t.revokedAt).slice(0, 10)
	);
	let shareInput: HTMLInputElement | null = $state(null);
	function gotoShare() {
		document.getElementById('share')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		shareInput?.focus({ preventScroll: true });
	}

	const bound = $derived(KINDS.filter((k) => person.bindings[k]));
</script>

<PageChrome
	title={person.displayName}
	crumbs={[
		{ label: 'People', href: resolve('/people'), icon: 'people' },
		{ label: person.displayName }
	]}
>
	{#snippet actions()}
		<Button size="sm" variant="ghost" icon="share" onclick={gotoShare}>Share page</Button>
		<Menu
			label="Person actions"
			items={[
				{ label: 'Rename', icon: 'edit', onselect: () => (renameOpen = true) },
				{ label: 'Add secret', icon: 'key', onselect: () => openSecret() },
				{ divider: true },
				{
					label: 'Revoke access',
					icon: 'lock',
					danger: true,
					disabled: person.disabled,
					onselect: () => (revokeOpen = true)
				},
				{ label: 'Delete person', icon: 'trash', danger: true, onselect: () => (deleteOpen = true) }
			]}
		/>
	{/snippet}
</PageChrome>

<div class="page">
	<PageHeader title={person.displayName} icon="person">
		<form
			bind:this={propsForm}
			method="POST"
			action="?/update"
			use:enhance={submitter(busy, 'props', { success: 'Saved' })}
		>
			<input type="hidden" name="tagsField" value="1" />
			<input type="hidden" name="disabled" value={disabled ? 'true' : 'false'} />
			<PropertyList>
				<Property label="Tags" icon="list">
					<div class="prop-tags">
						<TagInput
							name="tags"
							quiet
							bind:value={tags}
							suggestions={allTagsKnown}
							placeholder="Empty"
							onchange={saveProps}
						/>
					</div>
				</Property>
				<Property label="Access" icon="lock">
					<Toggle
						bind:checked={
							() => !disabled,
							(v) => {
								disabled = !v;
								void saveProps();
							}
						}
						label={disabled ? 'Disabled' : 'Enabled'}
						description={disabled ? 'Share links do not work while disabled' : undefined}
					/>
				</Property>
				<Property label="Created" icon="calendar" value={fmtDate(person.createdAt)} />
				<Property label="Share links" icon="link">
					{#if activeTokens.length}
						<button type="button" class="linkish" onclick={gotoShare}
							>{activeTokens.length} active</button
						>
					{:else}
						<span class="faint">None active</span>
					{/if}
				</Property>
				<Property label="Notes" icon="text">
					<textarea
						class="notes"
						name="notes"
						rows="1"
						placeholder="Empty"
						aria-label="Notes"
						bind:value={notes}
						onchange={saveProps}></textarea>
				</Property>
			</PropertyList>
		</form>
	</PageHeader>

	{#if person.disabled}
		<Callout color="gray" icon="lock" title="Access disabled">
			This person's configs are not pushed and their share links show "expired". Turn Access back on
			to re-enable, then push.
		</Callout>
	{/if}

	{#each KINDS as kind (kind)}
		<BindingSection
			{kind}
			binding={person.bindings[kind]}
			templates={data.templates.filter((t) => t.kind === kind)}
			preview={data.previews[kind]}
			{busy}
			personDisabled={person.disabled}
			ondiff={openDiff}
			{onconfirm}
		/>
	{/each}

	<Section
		title="Secrets"
		id="secrets"
		description="Values used by this person's templates. Person secrets override shared ones. Values are never shown again."
	>
		{#snippet actions()}
			<Button size="sm" variant="ghost" icon="plus" onclick={() => openSecret()}>Add secret</Button>
		{/snippet}
		{#if missingCount}
			<div class="mb">
				<Callout color="yellow"
					>{missingCount} required secret{missingCount === 1 ? ' is' : 's are'} missing. Pushes fail until
					{missingCount === 1 ? 'it is' : 'they are'} set.</Callout
				>
			</div>
		{/if}
		{#if secretRows.length === 0}
			<EmptyState
				compact
				icon="key"
				title="No secrets needed"
				description={bound.length
					? 'The bound templates do not use any placeholders.'
					: 'Bind a template to see which secrets it needs.'}
			/>
		{:else}
			<ul class="secrets">
				{#each secretRows as s (s.name)}
					<li>
						<span class="s-name mono">{s.name}</span>
						<span class="s-src">
							{#if s.satisfiedBy === 'person'}
								<Tag size="sm" color="blue" dot>Person</Tag>
							{:else if s.satisfiedBy === 'shared'}
								<Tag size="sm" color="purple" dot>Shared</Tag>
							{:else}
								<Tag size="sm" color="red" dot>Missing</Tag>
							{/if}
							{#if !s.required}<Tag size="sm" color="gray">Unused</Tag>{/if}
						</span>
						<span class="s-hint mono faint">{s.personHint ?? ''}</span>
						<span class="s-upd faint">{s.updatedAt ? fmtRelative(s.updatedAt) : ''}</span>
						<span class="s-act">
							<Button size="sm" variant="ghost" onclick={() => openSecret(s.name)}
								>{s.personHint
									? 'Replace'
									: s.satisfiedBy === 'shared'
										? 'Override'
										: 'Set'}</Button
							>
							{#if s.personHint}
								<Button
									size="sm"
									variant="ghost"
									onclick={() => {
										removeSecret = s.name;
										removeSecretOpen = true;
									}}>Remove</Button
								>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Section>

	<Section
		title="Share page"
		id="share"
		description="A private link that shows this person how to install their addons. No login needed."
	>
		<form
			class="share-form"
			method="POST"
			action="?/createShare"
			use:enhance={submitter(busy, 'share', {
				onsuccess: (d) => {
					const s = d?.share as { url?: string } | undefined;
					newShareUrl = s?.url ?? null;
				}
			})}
		>
			<Input
				name="expiresInDays"
				type="number"
				min="1"
				label="Expires after (days)"
				hint="Empty for no expiry"
				bind:value={shareExpiry}
				bind:ref={shareInput}
				size="sm"
			/>
			<Input
				name="maxViews"
				type="number"
				min="1"
				label="Max views"
				hint="Empty for unlimited"
				bind:value={shareViews}
				size="sm"
			/>
			<Button
				type="submit"
				size="sm"
				variant="primary"
				icon="link"
				loading={busy.is('share')}
				disabled={person.disabled || bound.length === 0}>Create link</Button
			>
		</form>
		{#if bound.length === 0}
			<p class="faint small">Bind at least one template before sharing.</p>
		{/if}
		{#if newShareUrl}
			<div class="mb">
				<Callout color="green" title="Copy this link now">
					It is shown only once. Send it to {person.displayName} privately.
					<div class="new-url">
						<code class="mono">{newShareUrl}</code>
					</div>
					{#snippet actions()}
						<CopyButton
							value={newShareUrl ?? ''}
							label="Copy"
							size="sm"
							copiedMessage="Share link copied"
						/>
						<Button size="sm" variant="ghost" onclick={() => (newShareUrl = null)}>Done</Button>
					{/snippet}
				</Callout>
			</div>
		{/if}
		{#if person.shareTokens.length}
			<table class="tokens">
				<thead>
					<tr>
						<th>Created</th>
						<th>Expires</th>
						<th>Views</th>
						<th>Status</th>
						<th><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each visibleTokens as t (t.id)}
						{@const st = tokenState(t)}
						<tr>
							<td title={fmtDateTime(t.createdAt)}>{fmtDate(t.createdAt)}</td>
							<td>{t.expiresAt ? fmtDate(t.expiresAt) : 'Never'}</td>
							<td>{t.views}{t.maxViews ? ` / ${t.maxViews}` : ''}</td>
							<td><Tag size="sm" color={st.color} dot>{st.label}</Tag></td>
							<td class="r">
								{#if !t.revokedAt}
									<form
										method="POST"
										action="?/revokeShare"
										use:enhance={submitter(busy, `rv-${t.id}`)}
									>
										<input type="hidden" name="tokenId" value={t.id} />
										<Button size="sm" variant="ghost" type="submit" loading={busy.is(`rv-${t.id}`)}
											>Revoke</Button
										>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if !showAllTokens && visibleTokens.length < person.shareTokens.length}
				<Button size="sm" variant="ghost" onclick={() => (showAllTokens = true)}
					>Show revoked ({person.shareTokens.length - visibleTokens.length})</Button
				>
			{/if}
		{/if}
	</Section>

	<Section title="History" id="history">
		<AuditList rows={person.history}>
			{#snippet empty()}
				<p class="faint small">Nothing recorded for this person yet.</p>
			{/snippet}
		</AuditList>
		{#if person.history.length}
			<div class="more">
				<Button
					size="sm"
					variant="ghost"
					href="{resolve('/audit')}?person={person.id}"
					iconRight="arrow-right">Full history</Button
				>
			</div>
		{/if}
	</Section>

	<Section title="Danger zone" id="danger">
		<div class="danger">
			<div class="dz-row">
				<div>
					<p class="dz-t">Revoke access</p>
					<p class="dz-d">
						Deletes both configs upstream, revokes every share link and disables this person. Their
						Stremio addons stop working.
					</p>
				</div>
				<Button
					variant="danger"
					size="sm"
					disabled={person.disabled}
					onclick={() => (revokeOpen = true)}>Revoke access</Button
				>
			</div>
			<div class="dz-row">
				<div>
					<p class="dz-t">Delete person</p>
					<p class="dz-d">
						Removes this person from the manager. You can keep or delete the upstream configs.
					</p>
				</div>
				<Button variant="danger" size="sm" onclick={() => (deleteOpen = true)}>Delete</Button>
			</div>
		</div>
	</Section>
</div>

<!-- Rename -->
<Modal bind:open={renameOpen} title="Rename" size="sm">
	<form
		id="rename"
		method="POST"
		action="?/update"
		use:enhance={submitter(busy, 'rename', {
			success: 'Renamed',
			onsuccess: () => (renameOpen = false)
		})}
	>
		<Input name="displayName" label="Name" value={person.displayName} required autocomplete="off" />
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (renameOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="rename" loading={busy.is('rename')}>Save</Button>
	{/snippet}
</Modal>

<!-- Diff -->
<Modal
	bind:open={diffOpen}
	title="{KIND_LABEL[diffKind]}: remote vs desired"
	description="Secrets are masked. Paths show where the live config differs from what the manager would push."
	size="lg"
>
	{#if diff}
		{#if diff.changes.length === 0}
			<Callout color="green" title="No differences"
				>The live config matches the desired config.</Callout
			>
		{:else}
			<ul class="changes">
				{#each diff.changes as c (c.path)}
					<li>
						<Tag size="sm" color={CHANGE_COLOR[c.kind]}>{c.kind}</Tag>
						<code class="mono">{c.path}</code>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="sbs">
			<div>
				<p class="sbs-h">Remote (live)</p>
				<JsonView value={diff.maskedRemote} maxHeight={360} label="Remote config" />
			</div>
			<div>
				<p class="sbs-h">Desired (manager)</p>
				<JsonView value={diff.maskedDesired} maxHeight={360} label="Desired config" />
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (diffOpen = false)}>Ignore</Button>
		{#if diff?.changes.length}
			<form
				method="POST"
				action="?/adopt"
				use:enhance={submitter(busy, 'adopt-diff', { onsuccess: () => (diffOpen = false) })}
			>
				<input type="hidden" name="kind" value={diffKind} />
				<Button type="submit" icon="download" loading={busy.is('adopt-diff')}>Adopt remote</Button>
			</form>
			<form
				method="POST"
				action="?/push"
				use:enhance={submitter(busy, 'push-diff', { onsuccess: () => (diffOpen = false) })}
			>
				<input type="hidden" name="kind" value={diffKind} />
				<Button type="submit" variant="primary" icon="upload" loading={busy.is('push-diff')}
					>Overwrite with desired</Button
				>
			</form>
		{/if}
	{/snippet}
</Modal>

<!-- Binding confirmations -->
<Modal
	bind:open={confirmOpen}
	size="sm"
	title={confirm?.what === 'rotate'
		? `Rotate ${KIND_LABEL[confirm.kind]} config?`
		: confirm?.what === 'adopt'
			? `Adopt remote ${confirm ? KIND_LABEL[confirm.kind] : ''} changes?`
			: `Remove ${confirm ? KIND_LABEL[confirm.kind] : ''} binding?`}
>
	{#if confirm}
		<form
			id="confirm-binding"
			class="stack"
			method="POST"
			action={confirm.what === 'rotate'
				? '?/rotate'
				: confirm.what === 'adopt'
					? '?/adopt'
					: '?/removeBinding'}
			use:enhance={submitter(busy, 'confirm', { onsuccess: () => (confirmOpen = false) })}
		>
			<input type="hidden" name="kind" value={confirm.kind} />
			{#if confirm.what === 'rotate'}
				<p>
					A new config with a new uuid and password is created from the same settings, and the old
					one is deleted upstream. {person.displayName} has to reinstall the addon from their share page.
				</p>
			{:else if confirm.what === 'adopt'}
				<p>
					The live config becomes this person's overrides, so the next push keeps what was changed
					upstream. The current overrides are replaced.
				</p>
			{:else}
				<p>The manager stops managing this config. The share page no longer lists it.</p>
				<Checkbox
					name="deleteUpstream"
					label="Also delete the config upstream"
					description="Their installed addon stops working. This cannot be undone."
				/>
			{/if}
		</form>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button
			type="submit"
			form="confirm-binding"
			variant={confirm?.what === 'adopt' ? 'primary' : 'danger'}
			loading={busy.is('confirm')}
			>{confirm?.what === 'rotate'
				? 'Rotate'
				: confirm?.what === 'adopt'
					? 'Adopt'
					: 'Remove'}</Button
		>
	{/snippet}
</Modal>

<!-- Set / replace secret -->
<Modal
	bind:open={secretOpen}
	title={secretFixed ? `Set ${secretName}` : 'Add secret'}
	description="Stored encrypted for {person.displayName} only. After saving you only see the last 4 characters."
	size="sm"
>
	<form
		id="secret-form"
		class="stack"
		method="POST"
		action="?/setSecret"
		use:enhance={submitter(busy, 'secret', {
			reset: true,
			onsuccess: () => (secretOpen = false),
			onfailure: (m) => (secretError = m)
		})}
	>
		{#if secretError}<Callout color="red">{secretError}</Callout>{/if}
		{#if secretFixed}
			<input type="hidden" name="name" value={secretName} />
		{:else}
			<Input
				name="name"
				label="Name"
				mono
				required
				bind:value={secretName}
				placeholder="rd_key"
				hint="Used in templates as {'{{'}secret:name}}"
				autocomplete="off"
				list="required-secrets"
			/>
			<datalist id="required-secrets">
				{#each secretRows.filter((r) => !r.personHint) as r (r.name)}<option value={r.name}
					></option>{/each}
			</datalist>
		{/if}
		<Input
			name="value"
			type="password"
			label="Value"
			required
			autocomplete="new-password"
			spellcheck="false"
		/>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (secretOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="secret-form" loading={busy.is('secret')}
			>Save</Button
		>
	{/snippet}
</Modal>

<Modal bind:open={removeSecretOpen} title="Remove {removeSecret}?" size="sm">
	<p>
		{#if person.requiredSecrets.some((r) => r.name === removeSecret)}
			The shared secret of the same name is used instead, if there is one. Otherwise pushes fail
			until it is set again.
		{:else}
			This secret is not used by the bound templates.
		{/if}
	</p>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (removeSecretOpen = false)}>Cancel</Button>
		<form
			method="POST"
			action="?/deleteSecret"
			use:enhance={submitter(busy, 'rmsecret', { onsuccess: () => (removeSecretOpen = false) })}
		>
			<input type="hidden" name="name" value={removeSecret ?? ''} />
			<Button type="submit" variant="danger" loading={busy.is('rmsecret')}>Remove</Button>
		</form>
	{/snippet}
</Modal>

<!-- Revoke -->
<Modal bind:open={revokeOpen} title="Revoke access for {person.displayName}?" size="sm">
	<p>
		Both configs are deleted upstream, every share link stops working and the person is disabled.
		Their Stremio addons stop working right away. Secrets and templates are kept.
	</p>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (revokeOpen = false)}>Cancel</Button>
		<form
			method="POST"
			action="?/revoke"
			use:enhance={submitter(busy, 'revoke', { onsuccess: () => (revokeOpen = false) })}
		>
			<Button type="submit" variant="danger" loading={busy.is('revoke')}>Revoke access</Button>
		</form>
	{/snippet}
</Modal>

<!-- Delete -->
<Modal bind:open={deleteOpen} title="Delete {person.displayName}?" size="sm">
	<form
		id="delete-person"
		class="stack"
		method="POST"
		action="?/delete"
		use:enhance={submitter(busy, 'delete')}
	>
		<p>The person, their secrets, share links and bindings are removed from the manager.</p>
		<Checkbox
			name="deleteUpstream"
			checked
			label="Also delete their configs upstream"
			description="Uncheck to leave the configs running unmanaged."
		/>
	</form>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (deleteOpen = false)}>Cancel</Button>
		<Button type="submit" form="delete-person" variant="danger" loading={busy.is('delete')}
			>Delete</Button
		>
	{/snippet}
</Modal>

<style>
	.prop-tags {
		flex: 1;
		min-width: 0;
		margin-left: -4px;
	}
	.notes {
		width: 100%;
		min-height: 28px;
		padding: 3px 6px;
		margin-left: -6px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		resize: vertical;
		field-sizing: content;
	}
	.notes:hover,
	.notes:focus {
		background: var(--bg-hover);
		outline: none;
	}
	.notes::placeholder {
		color: var(--text-tertiary);
	}
	.linkish {
		border: 0;
		background: none;
		padding: 0;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.mb {
		margin-bottom: 12px;
	}
	.small {
		font-size: 13px;
		margin: 4px 0;
	}
	.secrets {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 14px;
	}
	.secrets li {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 40px;
		border-bottom: 1px solid var(--divider);
	}
	.secrets li:last-child {
		border-bottom: 0;
	}
	.s-name {
		width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.s-src {
		display: flex;
		gap: 4px;
		width: 150px;
	}
	.s-hint {
		width: 80px;
	}
	.s-upd {
		flex: 1;
		font-size: 13px;
	}
	.s-act {
		display: flex;
		gap: 2px;
	}
	.share-form {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex-wrap: wrap;
		margin: 8px 0 12px;
	}
	.share-form :global(.field) {
		width: 170px;
	}
	.share-form > :global(.btn) {
		margin-top: 20px;
	}
	.new-url {
		margin-top: 8px;
		padding: 6px 8px;
		border-radius: var(--radius);
		background: var(--bg);
		word-break: break-all;
		font-size: 12px;
	}
	.tokens {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	.tokens th {
		text-align: left;
		font-weight: 500;
		font-size: 13px;
		color: var(--text-secondary);
		padding: 6px 8px 6px 0;
		border-bottom: 1px solid var(--divider);
	}
	.tokens td {
		padding: 4px 8px 4px 0;
		height: 38px;
		border-bottom: 1px solid var(--divider);
	}
	.tokens .r {
		text-align: right;
	}
	.more {
		margin-top: 8px;
	}
	.danger {
		border: 1px solid var(--danger-border);
		border-radius: var(--radius-lg);
	}
	.dz-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 14px 16px;
	}
	.dz-row + .dz-row {
		border-top: 1px solid var(--divider);
	}
	.dz-t {
		margin: 0;
		font-weight: 500;
		font-size: 14px;
	}
	.dz-d {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.changes {
		list-style: none;
		margin: 0 0 16px;
		padding: 0;
		max-height: 180px;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}
	.changes code,
	.new-url code {
		background: none;
		padding: 0;
		color: var(--text);
	}
	.changes li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sbs {
		display: grid;
		margin-top: 16px;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 16px;
	}
	.sbs-h {
		margin: 0 0 4px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	p {
		margin: 0;
	}
	@media (max-width: 640px) {
		.secrets li {
			flex-wrap: wrap;
			gap: 4px 8px;
			padding: 8px 0;
		}
		.s-name {
			width: auto;
			flex: 1;
		}
		.s-src,
		.s-hint {
			width: auto;
		}
		.s-upd {
			display: none;
		}
		.sbs {
			grid-template-columns: minmax(0, 1fr);
		}
		.dz-row {
			flex-direction: column;
			align-items: flex-start;
		}
		.tokens th:nth-child(1),
		.tokens td:nth-child(1) {
			display: none;
		}
	}
</style>
