<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon, type IconName } from '$lib/ui';
	import JobStatusTag from './JobStatusTag.svelte';
	import { KIND_LABEL, fmtDuration, fmtRelative, fmtDateTime } from './format';
	import type { JobRow } from './types';

	interface Props {
		jobs: JobRow[];
		/** Show attempts and full error text (Jobs page). */
		detailed?: boolean;
		empty?: Snippet;
	}
	let { jobs, detailed = false, empty }: Props = $props();

	const ICON: Record<string, IconName> = {
		push: 'upload',
		check: 'refresh',
		rotate: 'rotate',
		revoke: 'lock',
		delete: 'trash',
		import: 'download'
	};

	function typeLabel(t: string) {
		const s = t.replace(/[._]/g, ' ');
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
	function iconFor(t: string): IconName {
		const key = Object.keys(ICON).find((k) => t.includes(k));
		return key ? ICON[key] : 'jobs';
	}
	function took(j: JobRow) {
		if (!j.finishedAt) return '';
		return fmtDuration(new Date(j.finishedAt).getTime() - new Date(j.createdAt).getTime());
	}
	let openId = $state<string | null>(null);
</script>

{#if jobs.length === 0}
	{#if empty}{@render empty()}{:else}<p class="faint none">No jobs yet</p>{/if}
{:else}
	<ul class="jobs" aria-live="polite">
		{#each jobs as j (j.id)}
			<li class="job" class:failed={j.status === 'failed'}>
				<div class="main">
					<span class="ic"><Icon name={iconFor(j.type)} size={16} /></span>
					<span class="type">{typeLabel(j.type)}</span>
					<span class="target">
						{#if j.personName}{j.personName}{/if}{#if j.personName && j.kind}<span class="sep"
								>/</span
							>{/if}{#if j.kind}{KIND_LABEL[j.kind as keyof typeof KIND_LABEL] ?? j.kind}{/if}
						{#if !j.personName && !j.kind}<span class="faint">All</span>{/if}
					</span>
					<span class="note">
						{#if j.status === 'running' && j.progress}
							<span class="muted">{j.progress}</span>
						{:else if j.status === 'failed' && j.error}
							{#if detailed}
								<button
									type="button"
									class="err-toggle"
									aria-expanded={openId === j.id}
									onclick={() => (openId = openId === j.id ? null : j.id)}
								>
									<span class="err-text">{j.error}</span>
									<Icon name={openId === j.id ? 'chevron-up' : 'chevron-down'} size={14} />
								</button>
							{:else}
								<span class="err-text" title={j.error}>{j.error}</span>
							{/if}
						{:else if j.status === 'done'}
							<span class="faint">{took(j)}</span>
						{/if}
					</span>
					{#if detailed}
						<span class="attempts faint" title="Attempts">{j.attempts}x</span>
					{/if}
					<JobStatusTag status={j.status} title={j.error ?? undefined} />
					<time class="when faint" datetime={new Date(j.createdAt).toISOString()} title={fmtDateTime(j.createdAt)}
						>{fmtRelative(j.createdAt)}</time
					>
				</div>
				{#if detailed && openId === j.id && j.error}
					<pre class="err-detail">{j.error}</pre>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.none {
		font-size: 14px;
		margin: 8px 0;
	}
	.jobs {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 14px;
	}
	.job {
		border-bottom: 1px solid var(--divider);
	}
	.job:last-child {
		border-bottom: 0;
	}
	.main {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 38px;
		padding: 4px 2px;
	}
	.ic {
		display: inline-flex;
		color: var(--text-tertiary);
		flex: none;
	}
	.type {
		font-weight: 500;
		flex: none;
		min-width: 56px;
	}
	.target {
		flex: none;
		max-width: 38%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sep {
		color: var(--text-tertiary);
		margin: 0 4px;
	}
	.note {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.err-text {
		color: var(--danger-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.err-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		padding: 2px 4px;
		margin: -2px -4px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--danger-text);
		font: inherit;
		cursor: pointer;
	}
	.err-toggle:hover {
		background: var(--bg-hover);
	}
	.err-detail {
		margin: 0 0 10px 28px;
		padding: 10px 12px;
		border-radius: var(--radius-lg);
		background: var(--bg-code-block);
		font-family: var(--font-mono);
		font-size: 12px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.attempts {
		flex: none;
		font-size: 12px;
	}
	.when {
		flex: none;
		width: 84px;
		text-align: right;
		font-size: 13px;
	}
	@media (max-width: 640px) {
		.main {
			flex-wrap: wrap;
			gap: 4px 8px;
			padding: 8px 2px;
		}
		.target {
			max-width: none;
			flex: 1;
		}
		.note {
			order: 5;
			flex-basis: 100%;
			padding-left: 26px;
		}
		.note:empty {
			display: none;
		}
		.when {
			width: auto;
		}
	}
</style>
