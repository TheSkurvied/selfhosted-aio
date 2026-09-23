<script lang="ts">
	import type { Snippet } from 'svelte';
	import { usePageChrome } from './chrome.svelte';
	import type { Crumb } from './types';

	interface Props {
		/** Breadcrumbs for the top bar. Omit to use the layout's URL-derived default. */
		crumbs?: Crumb[];
		/** Buttons for the right side of the top bar. */
		actions?: Snippet;
		/** Document title; " - AIO Manager" is appended. */
		title?: string;
	}

	let { crumbs, actions, title }: Props = $props();

	usePageChrome({ crumbs: () => crumbs ?? null, actions: () => actions });
</script>

<svelte:head>
	{#if title}<title>{title} - AIO Manager</title>{/if}
</svelte:head>
