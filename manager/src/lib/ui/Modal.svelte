<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { focusables, trapTab } from './focus';

	interface Props {
		open?: boolean;
		title: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
		/** Called after the modal closes by Esc, backdrop or the close button. */
		onclose?: () => void;
		/** Close when clicking outside the panel. Default true. */
		dismissible?: boolean;
		children?: Snippet;
		/** Right-aligned action row at the bottom. */
		footer?: Snippet;
	}

	let {
		open = $bindable(false),
		title,
		description,
		size = 'md',
		onclose,
		dismissible = true,
		children,
		footer
	}: Props = $props();

	const uid = $props.id();
	let panel: HTMLElement | undefined = $state();

	function close() {
		open = false;
		onclose?.();
	}

	$effect(() => {
		if (!open || !panel) return;
		const previous = document.activeElement as HTMLElement | null;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		// Focus the first field if there is one, else the panel itself.
		const els = focusables(panel);
		const firstField = els.find((el) => el.matches('input, textarea, select, [autofocus]'));
		(firstField ?? panel).focus();
		return () => {
			document.body.style.overflow = prevOverflow;
			previous?.focus?.();
		};
	});

	function onkeydown(e: KeyboardEvent) {
		if (!panel) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
			return;
		}
		trapTab(e, panel);
	}
</script>

{#if open}
	<div class="overlay" role="presentation">
		<!-- Backdrop click target (keyboard users close with Esc or the close button). -->
		<div class="backdrop" role="presentation" onclick={() => dismissible && close()}></div>
		<div
			class="panel {size}"
			role="dialog"
			aria-modal="true"
			aria-labelledby="modal-{uid}-title"
			aria-describedby={description ? `modal-${uid}-desc` : undefined}
			tabindex="-1"
			bind:this={panel}
			{onkeydown}
		>
			<header>
				<div class="titles">
					<h2 id="modal-{uid}-title">{title}</h2>
					{#if description}<p id="modal-{uid}-desc">{description}</p>{/if}
				</div>
				<button type="button" class="close" aria-label="Close" onclick={close}>
					<Icon name="x" size={16} />
				</button>
			</header>
			{#if children}<div class="body">{@render children()}</div>{/if}
			{#if footer}<footer>{@render footer()}</footer>{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 12vh 16px 16px;
		overflow-y: auto;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--bg-overlay);
		animation: fade 120ms ease-out;
	}
	.panel {
		position: relative;
		width: 100%;
		max-width: 480px;
		border-radius: var(--radius-lg);
		background: var(--bg-elevated);
		box-shadow: var(--shadow-modal);
		animation: pop 140ms ease-out;
	}
	.panel.sm {
		max-width: 380px;
	}
	.panel.lg {
		max-width: 760px;
	}
	.panel:focus,
	.panel:focus-visible {
		box-shadow: var(--shadow-modal);
		border-radius: var(--radius-lg);
	}
	header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 20px 20px 0 24px;
	}
	.titles {
		flex: 1;
		min-width: 0;
		padding-top: 2px;
	}
	h2 {
		font-size: 16px;
		font-weight: 600;
		line-height: 1.4;
	}
	.titles p {
		margin-top: 4px;
		font-size: 14px;
		color: var(--text-secondary);
	}
	.close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		margin-right: -4px;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-tertiary);
		flex: none;
	}
	.close:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.body {
		padding: 16px 24px 4px;
		font-size: 14px;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
		padding: 16px 24px 20px;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(4px) scale(0.98);
		}
	}
	@media (max-width: 520px) {
		.overlay {
			padding-top: 8vh;
		}
	}
</style>
