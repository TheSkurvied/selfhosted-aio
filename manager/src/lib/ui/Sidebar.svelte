<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';

	interface Props {
		/** Workspace name in the header. */
		workspace?: string;
		/** Letter in the monogram mark. */
		mark?: string;
		/** Shows the collapse button (on header hover) and calls this. */
		oncollapse?: () => void;
		collapseLabel?: string;
		/** Nav items (SidebarItem). */
		children: Snippet;
		/** Pinned to the bottom: theme toggle, account, sign out. */
		footer?: Snippet;
		id?: string;
	}

	let {
		workspace = 'AIO Manager',
		mark = 'A',
		oncollapse,
		collapseLabel = 'Close sidebar',
		children,
		footer,
		id
	}: Props = $props();
</script>

<aside class="sb" {id} aria-label="Sidebar">
	<div class="head">
		<a class="ws" href="/">
			<span class="mark" aria-hidden="true">{mark}</span>
			<span class="name">{workspace}</span>
		</a>
		{#if oncollapse}
			<button type="button" class="collapse" aria-label={collapseLabel} title={collapseLabel} onclick={oncollapse}>
				<Icon name="sidebar-collapse" size={18} />
			</button>
		{/if}
	</div>
	<nav class="nav" aria-label="Main">
		{@render children()}
	</nav>
	{#if footer}<div class="foot">{@render footer()}</div>{/if}
</aside>

<style>
	.sb {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 100%;
		background: var(--bg-sidebar);
		color: var(--text-secondary);
		font-size: 14px;
		user-select: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 45px;
		padding: 0 8px;
		flex: none;
	}
	.ws {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		height: 30px;
		padding: 0 6px;
		border-radius: var(--radius-lg);
		color: var(--text);
		text-decoration: none;
		transition: background var(--ease);
	}
	.ws:hover {
		background: var(--bg-hover);
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: var(--radius);
		background: var(--text);
		color: var(--bg);
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
	}
	.name {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.collapse {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-tertiary);
		opacity: 0;
		transition:
			opacity var(--ease),
			background var(--ease);
	}
	.sb:hover .collapse,
	.collapse:focus-visible {
		opacity: 1;
	}
	.collapse:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	.nav {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 6px 8px;
		flex: 1;
		overflow-y: auto;
	}
	.foot {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 8px;
		border-top: 1px solid var(--divider);
		flex: none;
	}
	@media (hover: none) {
		.collapse {
			opacity: 1;
		}
	}
</style>
