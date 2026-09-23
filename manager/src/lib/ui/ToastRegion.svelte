<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';
	import { toasts } from './toast.svelte';
</script>

<!-- Mounted once in the root layout. Use `toast()` from $lib/ui to show messages. -->
<div class="region" aria-live="polite" aria-atomic="false">
	{#each toasts.items as t (t.id)}
		<div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
			{#if t.kind === 'success'}
				<Icon name="check" size={16} class="ti" />
			{:else if t.kind === 'error'}
				<Icon name="alert" size={16} class="ti" />
			{/if}
			<span class="msg">{t.message}</span>
			{#if t.action}
				<button
					type="button"
					class="act"
					onclick={() => {
						t.action?.onclick();
						toasts.dismiss(t.id);
					}}>{t.action.label}</button
				>
			{/if}
			<button type="button" class="x" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
				<Icon name="x" size={14} />
			</button>
		</div>
	{/each}
</div>

<style>
	.region {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 200;
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: 8px;
		width: max-content;
		max-width: calc(100vw - 32px);
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		max-width: 100%;
		padding: 6px 6px 6px 14px;
		border-radius: 20px;
		background: var(--bg-toast);
		color: var(--text-inverse);
		font-size: 14px;
		line-height: 1.35;
		box-shadow:
			0 0 0 1px rgba(15, 15, 15, 0.1),
			0 4px 12px rgba(15, 15, 15, 0.25);
		pointer-events: auto;
		animation: up 160ms ease-out;
	}
	.toast :global(.ti) {
		flex: none;
	}
	.success :global(.ti) {
		color: #6fcf97;
	}
	.error :global(.ti) {
		color: #ff7369;
	}
	.msg {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.act {
		flex: none;
		padding: 2px 8px;
		border: 0;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		font-size: 13px;
		font-weight: 500;
	}
	.act:hover {
		background: rgba(255, 255, 255, 0.2);
	}
	.x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: transparent;
		color: rgba(255, 255, 255, 0.5);
	}
	.x:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.1);
	}
	@keyframes up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
