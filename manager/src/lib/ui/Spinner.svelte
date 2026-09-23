<script lang="ts">
	interface Props {
		size?: number;
		/** Accessible label; decorative when omitted. */
		label?: string;
	}
	let { size = 16, label }: Props = $props();
</script>

<svg
	class="spin"
	width={size}
	height={size}
	viewBox="0 0 16 16"
	role={label ? 'status' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="1.5" />
	<path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
</svg>

<style>
	.spin {
		flex: none;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
