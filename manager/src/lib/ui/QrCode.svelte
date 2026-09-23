<script lang="ts">
	interface Props {
		/** SVG markup produced server-side by the `qrcode` package. */
		svg: string;
		/** Rendered size in px. */
		size?: number;
		/** Accessible description, e.g. "QR code for the AIOStreams manifest". */
		label?: string;
	}

	let { svg, size = 180, label = 'QR code' }: Props = $props();
</script>

<!-- Always dark-on-white so phones and TVs can scan it in dark mode too. -->
<div class="qr" role="img" aria-label={label} style:width="{size}px" style:height="{size}px">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html svg}
</div>

<style>
	.qr {
		display: inline-flex;
		padding: 8px;
		border-radius: var(--radius-lg);
		background: #fff;
		box-shadow: inset 0 0 0 1px var(--border);
		flex: none;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
