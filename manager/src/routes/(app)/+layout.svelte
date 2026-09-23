<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import SidebarItem from '$lib/ui/SidebarItem.svelte';
	import Breadcrumbs from '$lib/ui/Breadcrumbs.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import { providePageChrome } from '$lib/ui/chrome.svelte';
	import { theme } from '$lib/ui/theme.svelte';
	import type { Crumb } from '$lib/ui/types';

	let { data, children } = $props();

	const chrome = providePageChrome();

	const NAV: Array<{ href: string; label: string; icon: IconName }> = [
		{ href: '/', label: 'Dashboard', icon: 'home' },
		{ href: '/people', label: 'People', icon: 'people' },
		{ href: '/templates', label: 'Templates', icon: 'template' },
		{ href: '/secrets', label: 'Secrets', icon: 'key' },
		{ href: '/jobs', label: 'Jobs', icon: 'jobs' },
		{ href: '/audit', label: 'Audit log', icon: 'audit' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

	function isActive(href: string): boolean {
		const p = page.url.pathname;
		return href === '/' ? p === '/' : p === href || p.startsWith(href + '/');
	}

	/** Default crumbs when a page does not provide its own: the matching nav section. */
	const defaultCrumbs = $derived.by((): Crumb[] => {
		const item = NAV.find((n) => n.href !== '/' && isActive(n.href));
		if (item) return [{ label: item.label, href: item.href, icon: item.icon }];
		if (page.url.pathname === '/') return [{ label: 'Dashboard', href: '/', icon: 'home' }];
		const seg = page.url.pathname.split('/').filter(Boolean)[0] ?? '';
		return [{ label: seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ') }];
	});
	const crumbs = $derived(chrome.crumbs ?? defaultCrumbs);

	// Sidebar state: desktop collapse persists (html[data-sidebar]); mobile uses an overlay.
	let collapsed = $state(false);
	let mobileOpen = $state(false);

	onMount(() => {
		theme.init();
		collapsed = document.documentElement.dataset.sidebar === 'collapsed';
	});

	afterNavigate(() => {
		mobileOpen = false;
	});

	function setCollapsed(v: boolean) {
		collapsed = v;
		const root = document.documentElement;
		if (v) root.dataset.sidebar = 'collapsed';
		else delete root.dataset.sidebar;
		try {
			if (v) localStorage.setItem('aio-sidebar', 'collapsed');
			else localStorage.removeItem('aio-sidebar');
		} catch {
			/* ignore */
		}
	}

	function isMobile() {
		return window.matchMedia('(max-width: 768px)').matches;
	}

	function openSidebar() {
		if (isMobile()) mobileOpen = true;
		else setCollapsed(false);
	}

	function closeSidebar() {
		if (isMobile()) mobileOpen = false;
		else setCollapsed(true);
	}

	function onkeydown(e: KeyboardEvent) {
		// Cmd/Ctrl + \ toggles the sidebar, like Notion.
		if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
			e.preventDefault();
			if (isMobile()) mobileOpen = !mobileOpen;
			else setCollapsed(!collapsed);
		} else if (e.key === 'Escape' && mobileOpen) {
			mobileOpen = false;
		}
	}

	const themeIcon = $derived<IconName>(
		theme.choice === 'dark' ? 'moon' : theme.choice === 'light' ? 'sun' : 'circle-dashed'
	);
	const themeLabel = $derived(
		theme.choice === 'system' ? 'System' : theme.choice === 'dark' ? 'Dark' : 'Light'
	);
</script>

<svelte:window {onkeydown} />

<div class="shell" class:mobile-open={mobileOpen}>
	<div class="sidebar-slot" id="app-sidebar">
		<Sidebar oncollapse={closeSidebar} collapseLabel="Close sidebar">
			{#each NAV as item (item.href)}
				<SidebarItem
					href={item.href}
					label={item.label}
					icon={item.icon}
					active={isActive(item.href)}
					badge={item.href === '/people' && data.attention ? data.attention : null}
				/>
			{/each}

			{#snippet footer()}
				<Menu
					align="start"
					items={[
						{ heading: 'Appearance' },
						{
							label: 'Light',
							icon: 'sun',
							checked: theme.choice === 'light',
							onselect: () => theme.set('light')
						},
						{
							label: 'Dark',
							icon: 'moon',
							checked: theme.choice === 'dark',
							onselect: () => theme.set('dark')
						},
						{
							label: 'Use system setting',
							icon: 'circle-dashed',
							checked: theme.choice === 'system',
							onselect: () => theme.set('system')
						}
					]}
				>
					{#snippet trigger(props)}
						<button type="button" class="foot-item" {...props}>
							<span class="fi-ic"><Icon name={themeIcon} size={18} /></span>
							<span class="fi-lbl">Theme</span>
							<span class="fi-val">{themeLabel}</span>
						</button>
					{/snippet}
				</Menu>
				<div class="account">
					<span class="avatar" aria-hidden="true"
						>{(data.admin?.email ?? '?').charAt(0).toUpperCase()}</span
					>
					<span class="email" title={data.admin?.email}>{data.admin?.email ?? 'Signed in'}</span>
				</div>
				<form method="POST" action="/auth/logout">
					<button type="submit" class="foot-item">
						<span class="fi-ic"><Icon name="log-out" size={18} /></span>
						<span class="fi-lbl">Sign out</span>
					</button>
				</form>
			{/snippet}
		</Sidebar>
	</div>

	{#if mobileOpen}
		<button
			type="button"
			class="scrim"
			aria-label="Close sidebar"
			onclick={() => (mobileOpen = false)}
		></button>
	{/if}

	<div class="main">
		<header class="topbar">
			<div class="tb-left">
				<button
					type="button"
					class="open-sb"
					class:show={collapsed}
					aria-label="Open sidebar"
					aria-controls="app-sidebar"
					aria-expanded={mobileOpen}
					title="Open sidebar"
					onclick={openSidebar}
				>
					<Icon name="menu" size={18} />
				</button>
				<Breadcrumbs items={crumbs} />
			</div>
			{#if chrome.actions}
				<div class="tb-actions">{@render chrome.actions()}</div>
			{/if}
		</header>
		<main id="main">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.shell {
		display: flex;
		min-height: 100vh;
		background: var(--bg);
	}
	.sidebar-slot {
		position: sticky;
		top: 0;
		flex: none;
		width: var(--sidebar-width);
		height: 100vh;
		box-shadow: inset -1px 0 0 var(--divider);
		overflow: hidden;
		transition:
			width 200ms ease,
			transform 200ms ease;
		z-index: 30;
	}
	.sidebar-slot > :global(*) {
		width: var(--sidebar-width);
	}
	:global(html[data-sidebar='collapsed']) .sidebar-slot {
		width: 0;
		box-shadow: none;
		visibility: hidden;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.topbar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: var(--topbar-height);
		padding: 0 12px;
		background: var(--bg);
	}
	.tb-left {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.tb-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: none;
	}
	.open-sb {
		display: none;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-secondary);
		flex: none;
	}
	.open-sb:hover {
		background: var(--bg-hover);
		color: var(--text);
	}
	:global(html[data-sidebar='collapsed']) .open-sb,
	.open-sb.show {
		display: inline-flex;
	}
	main {
		flex: 1;
		min-width: 0;
	}

	/* Sidebar footer controls */
	.foot-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 30px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius-lg);
		background: transparent;
		color: var(--text-secondary);
		font-size: 14px;
		font-weight: 500;
		text-align: left;
		transition: background var(--ease);
	}
	.foot-item:hover,
	.foot-item[aria-expanded='true'] {
		background: var(--bg-hover);
	}
	.fi-ic {
		display: inline-flex;
		justify-content: center;
		width: 22px;
		flex: none;
	}
	.fi-lbl {
		flex: 1;
	}
	.fi-val {
		font-size: 12px;
		font-weight: 400;
		color: var(--text-tertiary);
	}
	:global(.sb .foot .menu-wrap) {
		display: flex;
	}
	.account {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 8px;
		margin-top: 4px;
		color: var(--text-secondary);
		font-size: 13px;
		min-width: 0;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: 50%;
		background: var(--tag-gray-bg);
		color: var(--tag-gray-text);
		font-size: 11px;
		font-weight: 600;
	}
	.email {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.scrim {
		display: none;
	}

	@media (max-width: 768px) {
		.sidebar-slot,
		:global(html[data-sidebar='collapsed']) .sidebar-slot {
			position: fixed;
			left: 0;
			top: 0;
			bottom: 0;
			width: min(280px, 85vw);
			height: 100%;
			transform: translateX(-100%);
			box-shadow: none;
			visibility: hidden;
			z-index: 80;
			transition:
				transform 200ms ease,
				visibility 200ms;
		}
		.sidebar-slot > :global(*) {
			width: 100%;
		}
		.mobile-open .sidebar-slot {
			visibility: visible;
			transform: none;
			box-shadow: var(--shadow-menu);
		}
		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 70;
			border: 0;
			padding: 0;
			background: var(--bg-overlay);
			opacity: 0.6;
		}
		.open-sb {
			display: inline-flex;
		}
		.topbar {
			padding: 0 8px;
		}
		/* Icon-only page actions and just the current crumb on phones. */
		.tb-actions :global(.btn:not(.icon-only):has(svg) .label) {
			display: none;
		}
		.tb-actions :global(.btn:not(.icon-only):has(svg)) {
			width: 28px;
			padding: 0;
		}
		.tb-left :global(.bc li:not(.last)) {
			display: none;
		}
		.tb-left :global(.bc li.last) {
			max-width: 100%;
		}
	}
</style>
