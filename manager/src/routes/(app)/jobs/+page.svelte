<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { EmptyState, PageChrome, PageHeader, Tabs, type TabItem } from '$lib/ui';
	import JobList from '../_lib/JobList.svelte';
	import { LiveJobs } from '../_lib/live-jobs.svelte';

	let { data } = $props();

	const base = resolve('/jobs');
	const tabs: TabItem[] = [
		{ id: '', label: 'All', icon: 'list', href: base },
		{ id: 'queued', label: 'Queued', icon: 'clock', href: `${base}?status=queued` },
		{ id: 'running', label: 'Running', icon: 'sync', href: `${base}?status=running` },
		{ id: 'done', label: 'Done', icon: 'check', href: `${base}?status=done` },
		{ id: 'failed', label: 'Failed', icon: 'alert', href: `${base}?status=failed` }
	];

	// The filter reads the current tab each time, so switching tabs needs no restart.
	const live = new LiveJobs({
		limit: 200,
		filter: (j) => !data.status || j.status === data.status,
		onpoll: () => invalidate('app:jobs')
	});
	$effect(() => live.reset(data.jobs));
	onMount(() => live.start());

	const EMPTY: Record<string, string> = {
		'': 'Pushes, checks, rotations and imports show up here.',
		queued: 'Nothing is waiting to run.',
		running: 'Nothing is running right now.',
		done: 'No finished jobs yet.',
		failed: 'No failures. Nice.'
	};
</script>

<PageChrome title="Jobs" />

<div class="page-wide">
	<PageHeader
		title="Jobs"
		icon="jobs"
		description="Background work against AIOStreams and AIOMetadata. Failed jobs retry a few times before they give up."
	>
		<div class="tabs-row">
			<Tabs {tabs} active={data.status} label="Job status" />
			<span class="live faint">
				{#if live.mode === 'live'}<span class="dot"
					></span>Live{:else if live.mode === 'polling'}Auto refresh{/if}
			</span>
		</div>
	</PageHeader>

	<div class="list">
		<JobList jobs={live.jobs} detailed>
			{#snippet empty()}
				<EmptyState icon="jobs" title="No jobs" description={EMPTY[data.status]} />
			{/snippet}
		</JobList>
	</div>
</div>

<style>
	.tabs-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		margin-top: 8px;
	}
	.tabs-row :global([role='tablist']) {
		flex: 1;
		min-width: 0;
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		padding-bottom: 10px;
		flex: none;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success-text);
	}
	.list {
		margin-top: 8px;
	}
</style>
