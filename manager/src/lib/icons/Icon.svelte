<script lang="ts">
	import { iconPaths, type IconName } from './paths';

	interface Props {
		name: IconName;
		/** Pixel size; 16 for inline chrome, 18 for sidebar, 20 for headers. */
		size?: number;
		strokeWidth?: number;
		/** Accessible label. When omitted the icon is decorative (aria-hidden). */
		label?: string;
		class?: string;
	}

	let { name, size = 16, strokeWidth = 1.5, label, class: klass = '' }: Props = $props();

	// Paths are static strings authored in this repo; never user input.
	const markup = $derived(iconPaths[name].join(''));
</script>

<svg
	class="icon {klass}"
	width={size}
	height={size}
	viewBox="0 0 20 20"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html markup}
</svg>

<style>
	.icon {
		flex: none;
		display: inline-block;
		vertical-align: middle;
	}
</style>
