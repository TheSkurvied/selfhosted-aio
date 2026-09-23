<script lang="ts">
	interface Props {
		/** 0..1. Omit for an indeterminate bar. */
		value?: number | null;
		label?: string;
		color?: 'accent' | 'green' | 'red' | 'yellow';
		/** Show the percentage on the right. */
		showValue?: boolean;
	}

	let { value = null, label, color = 'accent', showValue = false }: Props = $props();
	const pct = $derived(value === null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100));
</script>

<div class="pb">
	{#if label || (showValue && pct !== null)}
		<div class="head">
			{#if label}<span>{label}</span>{/if}
			{#if showValue && pct !== null}<span class="val">{pct}%</span>{/if}
		</div>
	{/if}
	<div
		class="track"
		role="progressbar"
		aria-label={label ?? 'Progress'}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={pct ?? undefined}
	>
		<div
			class="fill {color}"
			class:indet={pct === null}
			style:width={pct === null ? undefined : `${pct}%`}
		></div>
	</div>
</div>

<style>
	.pb {
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 100%;
	}
	.head {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.val {
		font-variant-numeric: tabular-nums;
	}
	.track {
		position: relative;
		height: 4px;
		border-radius: 2px;
		background: var(--bg-pressed);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 2px;
		transition: width 200ms ease;
	}
	.accent {
		background: var(--accent);
	}
	.green {
		background: var(--dot-green);
	}
	.red {
		background: var(--dot-red);
	}
	.yellow {
		background: var(--dot-yellow);
	}
	.indet {
		position: absolute;
		width: 35%;
		animation: slide 1.2s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			left: -35%;
		}
		to {
			left: 100%;
		}
	}
</style>
