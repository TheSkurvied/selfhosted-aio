<script lang="ts">
	import Tag from './Tag.svelte';
	import { SYNC_STATUS, type SyncStatus } from './types';

	interface Props {
		status: SyncStatus;
		size?: 'sm' | 'md';
		/** Extra detail shown as a native tooltip (e.g. the last error). */
		title?: string;
	}

	let { status, size = 'md', title }: Props = $props();
	const meta = $derived(SYNC_STATUS[status] ?? { label: status, color: 'gray' as const });
</script>

<Tag color={meta.color} label={meta.label} dot {size} {title} />
