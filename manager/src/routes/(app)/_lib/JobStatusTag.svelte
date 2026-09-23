<script lang="ts">
	import { Tag, Spinner, type TagColor } from '$lib/ui';
	import type { JobStatus } from './types';

	let { status, title }: { status: JobStatus | string; title?: string } = $props();

	const META: Record<string, { label: string; color: TagColor }> = {
		queued: { label: 'Queued', color: 'gray' },
		running: { label: 'Running', color: 'blue' },
		done: { label: 'Done', color: 'green' },
		failed: { label: 'Failed', color: 'red' }
	};
	const meta = $derived(META[status] ?? { label: status, color: 'gray' as TagColor });
</script>

<span class="jst">
	<Tag color={meta.color} dot={status !== 'running'} size="sm" {title}>
		{#if status === 'running'}<Spinner size={10} />{/if}
		{meta.label}
	</Tag>
</span>

<style>
	.jst :global(.spinner) {
		margin-right: 2px;
	}
</style>
