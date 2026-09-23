import type { IconName } from '$lib/icons/paths';

/** Mirrors the engine's SyncStatus (kept here so UI code never imports server modules). */
export type SyncStatus =
	| 'in_sync'
	| 'pending'
	| 'drifted'
	| 'missing'
	| 'error'
	| 'unbound'
	| 'never_pushed';

export type TagColor =
	| 'default'
	| 'gray'
	| 'brown'
	| 'orange'
	| 'yellow'
	| 'green'
	| 'blue'
	| 'purple'
	| 'pink'
	| 'red';

export const TAG_COLORS: TagColor[] = [
	'gray',
	'brown',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'red'
];

/** Stable color for free-form tags (e.g. a person's tags): hashes the text to a palette entry. */
export function tagColorFor(text: string): TagColor {
	let h = 0;
	for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
	return TAG_COLORS[h % TAG_COLORS.length];
}

export const SYNC_STATUS: Record<SyncStatus, { label: string; color: TagColor }> = {
	in_sync: { label: 'In sync', color: 'green' },
	pending: { label: 'Pending', color: 'yellow' },
	drifted: { label: 'Drifted', color: 'orange' },
	missing: { label: 'Missing', color: 'red' },
	error: { label: 'Error', color: 'red' },
	unbound: { label: 'Not bound', color: 'gray' },
	never_pushed: { label: 'Never pushed', color: 'blue' }
};

export interface Crumb {
	label: string;
	href?: string;
	icon?: IconName;
}

export type MenuEntry =
	| {
			label: string;
			icon?: IconName;
			/** Called on click / Enter. The menu closes afterwards. */
			onselect?: () => void;
			/** Renders the item as a link. */
			href?: string;
			/** Renders the item as a submit button (works without JS). Use with `form` and/or `formaction`. */
			submit?: boolean;
			form?: string;
			formaction?: string;
			danger?: boolean;
			disabled?: boolean;
			/** Short hint shown on the right, e.g. a keyboard shortcut. */
			hint?: string;
			/** Shows a check mark on the right when true (for option menus). */
			checked?: boolean;
	  }
	| { divider: true }
	| { heading: string };

export interface TableColumn<K extends string = string> {
	key: K;
	label: string;
	icon?: IconName;
	/** CSS width, e.g. '240px' or '30%'. */
	width?: string;
	align?: 'left' | 'right' | 'center';
	/** Hide this column below 768px. */
	hideOnMobile?: boolean;
}

export interface TabItem {
	id: string;
	label: string;
	icon?: IconName;
	count?: number;
	/** When set the tab is a link (URL-driven tabs). */
	href?: string;
}
