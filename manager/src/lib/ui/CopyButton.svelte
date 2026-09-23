<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';
	import { toast } from './toast.svelte';

	interface Props {
		/** Text to copy. */
		value: string;
		/** Button text. Omit for an icon-only button. */
		label?: string;
		/** Toast text after copying; set to '' to skip the toast. */
		copiedMessage?: string;
		size?: 'sm' | 'md';
		variant?: 'default' | 'ghost' | 'primary';
		/** Accessible name for the icon-only form. */
		ariaLabel?: string;
	}

	let {
		value,
		label,
		copiedMessage = 'Copied to clipboard',
		size = 'md',
		variant = label ? 'default' : 'ghost',
		ariaLabel = 'Copy'
	}: Props = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		let ok: boolean;
		try {
			await navigator.clipboard.writeText(value);
			ok = true;
		} catch {
			const ta = document.createElement('textarea');
			ta.value = value;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild(ta);
			ta.select();
			try {
				ok = document.execCommand('copy');
			} catch {
				ok = false;
			}
			ta.remove();
		}
		if (!ok) {
			toast.error('Could not copy. Select the text and copy it manually.');
			return;
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1500);
		if (copiedMessage) toast.success(copiedMessage, { duration: 2000 });
	}
</script>

<button
	type="button"
	class="cp {variant} {size}"
	class:icon-only={!label}
	onclick={copy}
	aria-label={label ? undefined : ariaLabel}
	title={label ? undefined : ariaLabel}
>
	<Icon name={copied ? 'check' : 'copy'} size={size === 'sm' ? 14 : 16} />
	{#if label}<span>{copied ? 'Copied' : label}</span>{/if}
</button>

<style>
	.cp {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--radius);
		font-size: 14px;
		font-weight: 500;
		white-space: nowrap;
		transition: background var(--ease);
		flex: none;
	}
	.cp.sm {
		height: 28px;
		padding: 0 8px;
	}
	.cp.icon-only {
		width: 28px;
		height: 28px;
		padding: 0;
	}
	.cp.icon-only.sm {
		width: 24px;
		height: 24px;
	}
	.default {
		background: var(--bg);
		color: var(--text);
		box-shadow: var(--shadow-button);
	}
	.default:hover {
		background: var(--bg-hover);
	}
	.ghost {
		background: transparent;
		color: var(--text-secondary);
	}
	.ghost:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.primary {
		background: var(--accent);
		color: #fff;
	}
	.primary:hover {
		background: var(--accent-hover);
	}
</style>
