<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import type { IconName } from '$lib/icons/paths';
	import type { MenuEntry } from './types';

	interface TriggerProps {
		id: string;
		'aria-haspopup': 'menu';
		'aria-expanded': boolean;
		'aria-controls': string;
		onclick: (e: MouseEvent) => void;
		onkeydown: (e: KeyboardEvent) => void;
	}

	interface Props {
		items: MenuEntry[];
		/** Accessible name for the default "..." trigger. */
		label?: string;
		/** Default trigger icon. */
		icon?: IconName;
		/** Custom trigger: spread `props` onto your <button>. */
		trigger?: Snippet<[props: TriggerProps]>;
		align?: 'start' | 'end';
		/** Min width of the popup in px. */
		width?: number;
		open?: boolean;
	}

	let {
		items,
		label = 'More actions',
		icon = 'more-horizontal',
		trigger,
		align = 'end',
		width = 220,
		open = $bindable(false)
	}: Props = $props();

	const uid = $props.id();
	const triggerId = `menu-${uid}-trigger`;
	const menuId = `menu-${uid}`;

	let wrap: HTMLElement | undefined = $state();
	let popup: HTMLElement | undefined = $state();
	let pos = $state({ top: 0, left: 0, up: false });

	function triggerEl(): HTMLElement | null {
		return document.getElementById(triggerId);
	}

	function itemEls(): HTMLElement[] {
		return popup ? Array.from(popup.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')) : [];
	}

	function place() {
		const t = triggerEl();
		if (!t || !popup) return;
		const r = t.getBoundingClientRect();
		const h = popup.offsetHeight;
		const w = popup.offsetWidth;
		const up = r.bottom + 4 + h > window.innerHeight - 8 && r.top - 4 - h > 8;
		let left = align === 'end' ? r.right - w : r.left;
		left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
		pos = { top: up ? r.top - 4 - h : r.bottom + 4, left, up };
	}

	async function openMenu(focus: 'first' | 'last' = 'first') {
		open = true;
		await tick();
		place();
		const els = itemEls();
		(focus === 'first' ? els[0] : els[els.length - 1])?.focus();
	}

	function closeMenu(returnFocus = true) {
		open = false;
		if (returnFocus) triggerEl()?.focus();
	}

	const triggerProps: TriggerProps = {
		id: triggerId,
		'aria-haspopup': 'menu',
		get 'aria-expanded'() {
			return open;
		},
		'aria-controls': menuId,
		onclick: () => (open ? closeMenu() : openMenu()),
		onkeydown: (e: KeyboardEvent) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				openMenu('first');
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				openMenu('last');
			}
		}
	};

	function onMenuKeydown(e: KeyboardEvent) {
		const els = itemEls();
		const i = els.indexOf(document.activeElement as HTMLElement);
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				els[(i + 1) % els.length]?.focus();
				break;
			case 'ArrowUp':
				e.preventDefault();
				els[(i - 1 + els.length) % els.length]?.focus();
				break;
			case 'Home':
				e.preventDefault();
				els[0]?.focus();
				break;
			case 'End':
				e.preventDefault();
				els[els.length - 1]?.focus();
				break;
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				closeMenu();
				break;
			case 'Tab':
				closeMenu(false);
				break;
			default:
				// Typeahead: jump to the next item starting with the typed letter.
				if (e.key.length === 1 && /\S/.test(e.key)) {
					const k = e.key.toLowerCase();
					const order = [...els.slice(i + 1), ...els.slice(0, i + 1)];
					order.find((el) => el.textContent?.trim().toLowerCase().startsWith(k))?.focus();
				}
		}
	}

	function onWindowPointer(e: PointerEvent) {
		if (!open) return;
		const t = e.target as Node;
		if (popup?.contains(t) || wrap?.contains(t)) return;
		closeMenu(false);
	}

	function select(entry: Extract<MenuEntry, { label: string }>) {
		if (entry.disabled) return;
		entry.onselect?.();
		// Let submit buttons and links do their default action before we unmount.
		setTimeout(() => closeMenu(!entry.href && !entry.submit), 0);
	}
</script>

<svelte:window
	onpointerdown={onWindowPointer}
	onresize={() => open && place()}
	onscroll={() => open && place()}
/>

<span class="menu-wrap" bind:this={wrap}>
	{#if trigger}
		{@render trigger(triggerProps)}
	{:else}
		<button type="button" class="dots" class:active={open} aria-label={label} title={label} {...triggerProps}>
			<Icon name={icon} size={18} />
		</button>
	{/if}

	{#if open}
		<div
			class="menu"
			id={menuId}
			role="menu"
			aria-labelledby={triggerId}
			tabindex="-1"
			bind:this={popup}
			style:top="{pos.top}px"
			style:left="{pos.left}px"
			style:min-width="{width}px"
			onkeydown={onMenuKeydown}
		>
			{#each items as entry, i (i)}
				{#if 'divider' in entry}
					<div class="div" role="separator"></div>
				{:else if 'heading' in entry}
					<div class="heading" role="presentation">{entry.heading}</div>
				{:else if entry.href && !entry.disabled}
					<a
						role="menuitem"
						tabindex="-1"
						class="item"
						class:danger={entry.danger}
						href={entry.href}
						onclick={() => select(entry)}
					>
						{#if entry.icon}<Icon name={entry.icon} size={16} />{/if}
						<span class="lbl">{entry.label}</span>
						{#if entry.hint}<span class="hint">{entry.hint}</span>{/if}
					</a>
				{:else}
					<button
						role="menuitem"
						tabindex="-1"
						class="item"
						class:danger={entry.danger}
						type={entry.submit ? 'submit' : 'button'}
						form={entry.form}
						formaction={entry.formaction}
						aria-disabled={entry.disabled ? 'true' : undefined}
						onclick={() => select(entry)}
					>
						{#if entry.icon}<Icon name={entry.icon} size={16} />{/if}
						<span class="lbl">{entry.label}</span>
						{#if entry.hint}<span class="hint">{entry.hint}</span>{/if}
						{#if entry.checked}<Icon name="check" size={16} class="chk" />{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</span>

<style>
	.menu-wrap {
		display: inline-flex;
		position: relative;
	}
	.dots {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-secondary);
		transition: background var(--ease);
	}
	.dots:hover,
	.dots.active {
		background: var(--bg-hover);
		color: var(--text);
	}
	.menu {
		position: fixed;
		z-index: 90;
		max-width: calc(100vw - 16px);
		max-height: 70vh;
		overflow-y: auto;
		padding: 6px 0;
		border-radius: var(--radius-lg);
		background: var(--bg-elevated);
		box-shadow: var(--shadow-menu);
		animation: in 90ms ease-out;
	}
	.menu:focus {
		box-shadow: var(--shadow-menu);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: calc(100% - 8px);
		min-height: 28px;
		margin: 0 4px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		font-size: 14px;
		line-height: 1.2;
		color: var(--text);
		text-align: left;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.item :global(svg) {
		color: var(--text-secondary);
	}
	.item:hover,
	.item:focus,
	.item:focus-visible {
		background: var(--bg-hover);
		box-shadow: none;
		outline: none;
	}
	.item.danger,
	.item.danger :global(svg) {
		color: var(--danger-text);
	}
	.item[aria-disabled='true'] {
		opacity: 0.4;
		cursor: default;
	}
	.item[aria-disabled='true']:hover {
		background: transparent;
	}
	.lbl {
		flex: 1;
	}
	.hint {
		font-size: 12px;
		color: var(--text-tertiary);
		margin-left: 12px;
	}
	.item :global(.chk) {
		color: var(--text);
	}
	.div {
		height: 1px;
		margin: 6px 0;
		background: var(--divider);
	}
	.heading {
		padding: 6px 14px 4px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-tertiary);
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(-2px);
		}
	}
</style>
