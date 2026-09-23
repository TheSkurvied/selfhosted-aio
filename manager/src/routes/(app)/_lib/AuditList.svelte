<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tag, tagColorFor } from '$lib/ui';
	import { fmtDateTime, fmtRelative } from './format';
	import type { AuditRow } from './types';

	interface Props {
		rows: AuditRow[];
		/** Hide the actor column (e.g. person history is mostly one admin). */
		showActor?: boolean;
		empty?: Snippet;
	}
	let { rows, showActor = true, empty }: Props = $props();

	function actorName(email: string) {
		return email === 'system' ? 'system' : email.split('@')[0];
	}
</script>

{#if rows.length === 0}
	{#if empty}{@render empty()}{:else}<p class="faint none">Nothing recorded yet</p>{/if}
{:else}
	<ul class="audit">
		{#each rows as r (r.id)}
			<li>
				<time class="when" datetime={new Date(r.at).toISOString()} title={fmtDateTime(r.at)}
					>{fmtRelative(r.at)}</time
				>
				{#if showActor}
					<span class="actor" class:system={r.actorEmail === 'system'} title={r.actorEmail}
						>{actorName(r.actorEmail)}</span
					>
				{/if}
				<span class="action"
					><Tag size="sm" color={tagColorFor(r.action.split('.')[0])}>{r.action}</Tag></span
				>
				<span class="summary">
					{r.summary}
					{#if r.diffPaths?.length}
						<span class="paths faint mono" title={r.diffPaths.join(', ')}
							>{r.diffPaths.slice(0, 3).join(', ')}{r.diffPaths.length > 3
								? ` +${r.diffPaths.length - 3}`
								: ''}</span
						>
					{/if}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.none {
		font-size: 14px;
		margin: 8px 0;
	}
	.audit {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 14px;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 7px 2px;
		border-bottom: 1px solid var(--divider);
	}
	li:last-child {
		border-bottom: 0;
	}
	.when {
		flex: none;
		width: 92px;
		color: var(--text-tertiary);
		font-size: 13px;
	}
	.actor {
		flex: none;
		width: 90px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.actor.system {
		color: var(--text-tertiary);
		font-style: italic;
	}
	.action {
		flex: none;
	}
	.summary {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.paths {
		margin-left: 6px;
		font-size: 12px;
	}
	@media (max-width: 640px) {
		li {
			flex-wrap: wrap;
			gap: 2px 8px;
		}
		.summary {
			flex-basis: 100%;
		}
		.when,
		.actor {
			width: auto;
		}
	}
</style>
