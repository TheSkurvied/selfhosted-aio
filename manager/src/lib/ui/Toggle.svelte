<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'type'> {
		checked?: boolean;
		label?: string;
		description?: string;
		/** Put the switch on the right of the label (settings-row style). */
		labelFirst?: boolean;
	}

	let {
		checked = $bindable(false),
		label,
		description,
		labelFirst = false,
		id,
		class: klass = '',
		...rest
	}: Props = $props();

	const uid = $props.id();
	const tId = $derived(id ?? `tg-${uid}`);
</script>

<label class="toggle {klass}" class:label-first={labelFirst} for={tId}>
	<span class="sw">
		<input type="checkbox" role="switch" id={tId} bind:checked {...rest} />
		<span class="track" aria-hidden="true"><span class="thumb"></span></span>
	</span>
	{#if label}
		<span class="text">
			{label}
			{#if description}<span class="desc">{description}</span>{/if}
		</span>
	{/if}
</label>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		line-height: 20px;
		cursor: pointer;
		user-select: none;
	}
	.toggle.label-first {
		flex-direction: row-reverse;
		justify-content: space-between;
		width: 100%;
	}
	.sw {
		position: relative;
		display: inline-flex;
		flex: none;
	}
	input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}
	.track {
		position: relative;
		flex: none;
		width: 30px;
		height: 18px;
		border-radius: 44px;
		background: rgba(135, 131, 120, 0.3);
		transition: background 200ms ease;
	}
	.thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgba(15, 15, 15, 0.2);
		transition: transform 200ms ease;
	}
	input:checked + .track {
		background: var(--accent);
	}
	input:checked + .track .thumb {
		transform: translateX(12px);
	}
	input:focus-visible + .track {
		box-shadow: var(--focus-ring);
	}
	input:disabled + .track {
		opacity: 0.4;
	}
	.text {
		display: flex;
		flex-direction: column;
		color: var(--text);
	}
	.desc {
		font-size: 12px;
		line-height: 16px;
		color: var(--text-secondary);
	}
</style>
