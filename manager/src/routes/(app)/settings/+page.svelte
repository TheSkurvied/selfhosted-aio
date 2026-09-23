<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Button,
		Callout,
		CopyButton,
		EmptyState,
		Icon,
		PageChrome,
		PageHeader,
		Tag,
		toast
	} from '$lib/ui';
	import Section from '../_lib/Section.svelte';
	import { Busy, callAction, submitter } from '../_lib/forms.svelte';
	import { KIND_LABEL, fmtDate, plural } from '../_lib/format';

	let { data } = $props();
	const s = $derived(data.settings);
	const busy = new Busy();

	type Orphan = { kind: 'aiostreams' | 'aiometadata'; uuid: string; createdAt?: string };
	let orphans = $state<Orphan[] | null>(null);
	async function runOrphans() {
		busy.start('orphans');
		try {
			const res = await callAction<{ orphans: Orphan[] }>('?/orphans');
			orphans = res.orphans;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Orphan report failed');
		} finally {
			busy.stop('orphans');
		}
	}
</script>

<PageChrome title="Settings" />

<div class="page">
	<PageHeader
		title="Settings"
		icon="settings"
		description="Read-only view of how this manager is configured. Instances, OIDC and notifications come from environment variables."
	/>

	<Section title="Instances" id="instances">
		<div class="cards">
			{#each s.instances as inst (inst.kind)}
				<div class="card">
					<div class="card-h">
						<Icon name="server" size={18} />
						<span class="card-t">{KIND_LABEL[inst.kind]}</span>
						{#if inst.authConfigured}
							<Tag size="sm" color="green" icon="lock">Credentials set</Tag>
						{:else}
							<Tag size="sm" color="gray">No credentials</Tag>
						{/if}
					</div>
					<dl>
						<dt>Internal URL</dt>
						<dd class="mono">{inst.internalUrl}</dd>
						<dt>Public URL</dt>
						<dd class="mono">{inst.publicUrl}</dd>
						<dt>Credentials</dt>
						<dd class="mono faint">{inst.authConfigured ? '••••••••' : 'Not configured'}</dd>
					</dl>
				</div>
			{/each}
		</div>
		<p class="faint small">
			Change these with the <span class="mono">AIOSTREAMS_*</span> and <span class="mono">AIOMETADATA_*</span>
			environment variables and restart.
		</p>
	</Section>

	<Section title="Admins" id="admins">
		<ul class="rows">
			{#each s.admins as a (a.id)}
				<li>
					<span class="avatar" aria-hidden="true">{a.email.charAt(0).toUpperCase()}</span>
					<span class="grow">
						{a.email}
						{#if a.id === data.me}<span class="faint">(you)</span>{/if}
					</span>
					{#if a.totp}<Tag size="sm" color="green" icon="shield">TOTP</Tag>{/if}
					{#if a.oidc}<Tag size="sm" color="blue" icon="link">SSO</Tag>{/if}
					<span class="faint small">since {fmtDate(a.createdAt)}</span>
				</li>
			{/each}
		</ul>
		<p class="faint small">
			Reset an admin's password or TOTP from the server shell with
			<span class="mono">node build/cli/reset-admin.mjs</span>.
		</p>
	</Section>

	<Section title="Security" id="security">
		<ul class="rows">
			<li>
				<span class="label">Single sign-on (OIDC)</span>
				<span class="grow"></span>
				{#if s.oidcEnabled}
					<Tag size="sm" color="green" dot>Enabled</Tag>
				{:else}
					<Tag size="sm" color="gray" dot>Off</Tag>
				{/if}
			</li>
			<li>
				<span class="label">Encryption key fingerprint</span>
				<span class="grow"></span>
				<code class="mono fp">{s.keyFingerprint}</code>
				<CopyButton value={s.keyFingerprint} size="sm" ariaLabel="Copy fingerprint" copiedMessage="Fingerprint copied" />
			</li>
		</ul>
		<Callout color="gray" icon="key">
			Keep a copy of <span class="mono">MANAGER_KEY</span> with your backups. Compare its fingerprint with the
			one above to check that a backup key matches this database.
		</Callout>
	</Section>

	<Section title="Checks and notifications" id="checks">
		<ul class="rows">
			<li>
				<span class="label">Scheduled drift check</span>
				<span class="grow"></span>
				{#if s.checkIntervalHours > 0}
					<span>Every {plural(s.checkIntervalHours, 'hour')}</span>
				{:else}
					<Tag size="sm" color="gray">Disabled</Tag>
				{/if}
			</li>
			<li>
				<span class="label">ntfy notifications</span>
				<span class="grow"></span>
				{#if s.ntfy}
					<Tag size="sm" color="green" dot>On</Tag>
				{:else}
					<Tag size="sm" color="gray" dot>Off</Tag>
				{/if}
			</li>
		</ul>
	</Section>

	<Section
		title="Orphan report"
		id="orphans"
		description="Configs that exist upstream but that the manager does not track."
	>
		{#snippet actions()}
			<Button size="sm" icon="search" loading={busy.is('orphans')} onclick={runOrphans}
				>{orphans ? 'Run again' : 'Run report'}</Button
			>
		{/snippet}
		{#if orphans === null}
			<p class="faint small">Not run yet. Listing AIOStreams users needs the manager's AIOStreams admin login.</p>
		{:else if orphans.length === 0}
			<EmptyState compact icon="check" title="No orphans" description="Every upstream config is managed." />
		{:else}
			<ul class="rows">
				{#each orphans as o (o.kind + o.uuid)}
					<li>
						<Tag size="sm" color={o.kind === 'aiostreams' ? 'blue' : 'purple'}>{KIND_LABEL[o.kind]}</Tag>
						<code class="mono grow uuid">{o.uuid}</code>
						{#if o.createdAt}<span class="faint small">{fmtDate(o.createdAt)}</span>{/if}
					</li>
				{/each}
			</ul>
			<p class="faint small">Import them from People &rsaquo; Import to manage them.</p>
		{/if}
	</Section>

	<Section title="Starter templates" id="starters">
		{#snippet actions()}
			<form method="POST" action="?/seed" use:enhance={submitter(busy, 'seed')}>
				<Button size="sm" type="submit" icon="download" loading={busy.is('seed')}>Add starters</Button>
			</form>
		{/snippet}
		<ul class="rows">
			{#each data.starters as st (st.name)}
				<li>
					<Icon name="file" size={16} />
					<span class="grow">{st.name}</span>
					<Tag size="sm" color={st.kind === 'aiostreams' ? 'blue' : 'purple'}>{KIND_LABEL[st.kind]}</Tag>
				</li>
			{/each}
		</ul>
		<p class="faint small">Templates with the same name are skipped.</p>
	</Section>

	<Section title="Appearance" id="design">
		<ul class="rows">
			<li>
				<span class="label">Style guide</span>
				<span class="grow"></span>
				<Button size="sm" variant="ghost" href={resolve('/styleguide')} iconRight="arrow-right"
					>Open</Button
				>
			</li>
		</ul>
	</Section>
</div>

<style>
	.small {
		font-size: 13px;
		margin: 8px 0 0;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin-top: 12px;
	}
	.card {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 14px 16px;
		min-width: 0;
	}
	.card-h {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-secondary);
		margin-bottom: 10px;
	}
	.card-t {
		flex: 1;
		font-weight: 600;
		color: var(--text);
	}
	dl {
		margin: 0;
		font-size: 13px;
	}
	dt {
		color: var(--text-tertiary);
		font-size: 12px;
		margin-top: 8px;
	}
	dd {
		margin: 2px 0 0;
		overflow-wrap: anywhere;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 14px;
	}
	.rows li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		border-bottom: 1px solid var(--divider);
		flex-wrap: wrap;
		padding: 4px 0;
	}
	.rows li:last-child {
		border-bottom: 0;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	.label {
		color: var(--text);
	}
	.fp {
		font-size: 12px;
		background: none;
		padding: 0;
		overflow-wrap: anywhere;
	}
	.uuid {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		background: none;
		padding: 0;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: 50%;
		background: var(--tag-gray-bg);
		color: var(--tag-gray-text);
		font-size: 11px;
		font-weight: 600;
	}
	:global(#security) .rows {
		margin-bottom: 12px;
	}
	@media (max-width: 640px) {
		.cards {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
