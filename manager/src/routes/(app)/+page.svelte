<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		Button,
		Callout,
		EmptyState,
		Icon,
		PageChrome,
		PageHeader,
		Spinner,
		StatusTag,
		Tag,
		type SyncStatus
	} from '$lib/ui';
	import Section from './_lib/Section.svelte';
	import JobList from './_lib/JobList.svelte';
	import AuditList from './_lib/AuditList.svelte';
	import { LiveJobs } from './_lib/live-jobs.svelte';
	import { Busy, submitter } from './_lib/forms.svelte';
	import { KIND_LABEL } from './_lib/format';

	let { data } = $props();

	const busy = new Busy();
	const live = new LiveJobs({
		limit: 8,
		onpoll: () => invalidate('app:jobs'),
		onjob: (j) => {
			if (j.status === 'done' || j.status === 'failed') scheduleSyncRefresh();
		}
	});
	$effect(() => live.reset(data.jobs));
	onMount(() => live.start());

	// Coalesce sync-count refreshes while a batch of jobs finishes.
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSyncRefresh() {
		if (refreshTimer) return;
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			void invalidate('app:sync');
		}, 1500);
	}

	const ORDER: SyncStatus[] = ['in_sync', 'pending', 'drifted', 'missing', 'error', 'never_pushed'];
	const total = $derived(ORDER.reduce((n, s) => n + (data.summary[s] ?? 0), 0));
	const needsAttention = $derived(
		(data.summary.drifted ?? 0) + (data.summary.missing ?? 0) + (data.summary.error ?? 0)
	);

	let openDetails = $state<Record<string, boolean>>({});

	function latency(checks: Array<{ latencyMs: number }>) {
		if (!checks.length) return null;
		return Math.max(...checks.map((c) => c.latencyMs));
	}
</script>

<PageChrome title="Dashboard" />

<div class="page">
	<PageHeader
		title="Dashboard"
		icon="home"
		description="Health of both upstreams, sync state of every configuration, and what the manager is doing right now."
	/>

	<Section title="Health" id="health">
		{#snippet actions()}
			<form method="POST" action="?/health" use:enhance={submitter(busy, 'health')}>
				<Button size="sm" variant="ghost" type="submit" icon="refresh" loading={busy.is('health')}
					>Recheck</Button
				>
			</form>
		{/snippet}
		{#await data.health}
			<div class="health-loading" role="status">
				<Spinner size={14} /> <span class="muted">Checking AIOStreams and AIOMetadata...</span>
			</div>
		{:then res}
			{#if !res.ok}
				<Callout color="red" title="Health check failed">{res.error}</Callout>
			{:else}
				<ul class="health">
					{#each res.value as inst (inst.kind)}
						{@const ms = latency(inst.checks)}
						<li class="inst">
							<div class="inst-row">
								<span class="inst-ic" class:bad={!inst.ok}><Icon name="server" size={18} /></span>
								<span class="inst-name">{KIND_LABEL[inst.kind]}</span>
								<span class="inst-ver mono"
									>{inst.version ? `v${inst.version}` : 'version unknown'}</span
								>
								<Tag color={inst.ok ? 'green' : 'red'} dot size="sm"
									>{inst.ok ? 'Healthy' : 'Unhealthy'}</Tag
								>
								<span class="checks">
									{#each inst.checks as c (c.endpoint)}
										<span class="chk" class:warn={!c.ok} title={c.detail ?? c.endpoint}>
											<Icon name={c.ok ? 'check' : 'alert'} size={13} />{c.endpoint}
										</span>
									{/each}
								</span>
								{#if ms !== null}<span class="lat faint">{ms} ms</span>{/if}
								<Button
									size="sm"
									variant="ghost"
									iconRight={openDetails[inst.kind] ? 'chevron-up' : 'chevron-down'}
									aria-expanded={!!openDetails[inst.kind]}
									aria-controls="health-{inst.kind}"
									onclick={() => (openDetails[inst.kind] = !openDetails[inst.kind])}>Details</Button
								>
							</div>
							{#if openDetails[inst.kind]}
								<div class="details" id="health-{inst.kind}">
									<p class="faint pub">Public URL <span class="mono">{inst.publicUrl}</span></p>
									<table class="ctbl">
										<thead>
											<tr
												><th>Endpoint</th><th>Result</th><th class="r">Latency</th><th>Detail</th
												></tr
											>
										</thead>
										<tbody>
											{#each inst.checks as c (c.endpoint)}
												<tr>
													<td class="mono">{c.endpoint}</td>
													<td
														><Tag size="sm" color={c.ok ? 'green' : 'red'}
															>{c.ok ? 'OK' : 'Failed'}</Tag
														></td
													>
													<td class="r">{c.latencyMs} ms</td>
													<td class="muted">{c.detail ?? ''}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/await}
	</Section>

	<Section title="Sync" id="sync" description="{total} configurations across both services">
		{#snippet actions()}
			<form method="POST" action="?/checkAll" use:enhance={submitter(busy, 'check')}>
				<Button size="sm" type="submit" icon="refresh" loading={busy.is('check')}
					>Check all now</Button
				>
			</form>
			<form method="POST" action="?/pushPending" use:enhance={submitter(busy, 'push')}>
				<Button
					size="sm"
					type="submit"
					variant="primary"
					icon="upload"
					loading={busy.is('push')}
					disabled={!data.summary.pending}>Push all pending</Button
				>
			</form>
		{/snippet}
		<div class="stats">
			{#each ORDER as s (s)}
				<a class="stat" href="{resolve('/people')}?status={s}" class:zero={!data.summary[s]}>
					<span class="stat-n">{data.summary[s] ?? 0}</span>
					<StatusTag status={s} size="sm" />
				</a>
			{/each}
		</div>
		{#if needsAttention > 0}
			<div class="attn">
				<Callout color="yellow" title="{needsAttention} need attention">
					Drifted, missing or failed configurations do not fix themselves. Open People and filter by
					status to diff, adopt or re-push them.
				</Callout>
			</div>
		{/if}
	</Section>

	<Section title="Jobs" id="jobs">
		{#snippet actions()}
			<span class="live faint" title="Updates stream in live">
				{#if live.mode === 'live'}<span class="dot"
					></span>Live{:else if live.mode === 'polling'}Refreshing{/if}
			</span>
			<Button size="sm" variant="ghost" href={resolve('/jobs')} iconRight="arrow-right"
				>All jobs</Button
			>
		{/snippet}
		<JobList jobs={live.jobs}>
			{#snippet empty()}
				<EmptyState
					compact
					icon="jobs"
					title="No jobs yet"
					description="Pushes, checks and rotations show up here while they run."
				/>
			{/snippet}
		</JobList>
	</Section>

	<Section title="Recent activity" id="audit">
		{#snippet actions()}
			<Button size="sm" variant="ghost" href={resolve('/audit')} iconRight="arrow-right"
				>Audit log</Button
			>
		{/snippet}
		<AuditList rows={data.audit}>
			{#snippet empty()}
				<EmptyState
					compact
					icon="audit"
					title="No activity yet"
					description="Every change made here is recorded in the audit log."
				/>
			{/snippet}
		</AuditList>
	</Section>
</div>

<style>
	.health-loading {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 2px;
		font-size: 14px;
	}
	.health {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.inst {
		border-bottom: 1px solid var(--divider);
	}
	.inst:last-child {
		border-bottom: 0;
	}
	.inst-row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-size: 14px;
		flex-wrap: wrap;
		padding: 4px 0;
	}
	.inst-ic {
		display: inline-flex;
		color: var(--text-secondary);
	}
	.inst-ic.bad {
		color: var(--danger-text);
	}
	.inst-name {
		font-weight: 600;
		width: 100px;
	}
	.inst-ver {
		color: var(--text-secondary);
		width: 110px;
	}
	.checks {
		display: flex;
		gap: 10px;
		flex: 1;
		min-width: 0;
		flex-wrap: wrap;
	}
	.chk {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-secondary);
		font-size: 13px;
	}
	.chk :global(svg) {
		color: var(--success-text);
	}
	.chk.warn,
	.chk.warn :global(svg) {
		color: var(--warning-text);
	}
	.lat {
		font-size: 13px;
		width: 64px;
		text-align: right;
	}
	.details {
		padding: 0 0 14px 28px;
	}
	.pub {
		font-size: 13px;
		margin: 0 0 8px;
	}
	.ctbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.ctbl th {
		text-align: left;
		font-weight: 500;
		color: var(--text-secondary);
		padding: 4px 8px 4px 0;
		border-bottom: 1px solid var(--divider);
	}
	.ctbl td {
		padding: 6px 8px 6px 0;
		border-bottom: 1px solid var(--divider);
		vertical-align: top;
	}
	.ctbl .r {
		text-align: right;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 8px;
		margin-top: 12px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 12px 12px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		color: inherit;
		text-decoration: none;
		transition: background var(--ease);
	}
	.stat:hover {
		background: var(--bg-hover);
	}
	.stat:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.stat-n {
		font-size: 28px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.01em;
	}
	.stat.zero .stat-n {
		color: var(--text-tertiary);
	}
	.attn {
		margin-top: 12px;
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		margin-right: 4px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success-text);
	}
	@media (max-width: 900px) {
		.stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 640px) {
		.inst-name,
		.inst-ver {
			width: auto;
		}
		.checks {
			order: 5;
			flex-basis: 100%;
			padding-left: 28px;
		}
		.lat {
			width: auto;
			margin-left: auto;
		}
		.details {
			padding-left: 0;
			overflow-x: auto;
		}
	}
</style>
