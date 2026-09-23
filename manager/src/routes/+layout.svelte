<script lang="ts">
	import '../app.css';
	import favicon from '$lib/icons/favicon.svg';
	import { ToastRegion } from '$lib/ui';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AIO Manager</title>
</svelte:head>

{@render children()}

<ToastRegion />
