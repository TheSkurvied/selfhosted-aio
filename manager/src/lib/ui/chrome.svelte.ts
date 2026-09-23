import { getContext, setContext, type Snippet } from 'svelte';
import type { Crumb } from './types';

const KEY = Symbol('aio-page-chrome');

/** Shared state between the (app) layout's top bar and the current page. */
export class PageChromeState {
	crumbs = $state<Crumb[] | null>(null);
	actions = $state<Snippet | null>(null);
	owner = 0;
}

let ownerSeq = 0;

/** Called once by src/routes/(app)/+layout.svelte. */
export function providePageChrome(): PageChromeState {
	return setContext(KEY, new PageChromeState());
}

export function getPageChrome(): PageChromeState | undefined {
	return getContext<PageChromeState | undefined>(KEY);
}

/**
 * Register breadcrumbs and top-bar actions for the current page. Call during component init.
 * Both are re-read reactively; everything is cleared when the calling component unmounts.
 *
 *   usePageChrome({ crumbs: () => [{ label: 'People', href: '/people' }, { label: person.displayName }], actions });
 */
export function usePageChrome(opts: {
	crumbs?: () => Crumb[] | null;
	actions?: () => Snippet | null | undefined;
}) {
	const chrome = getPageChrome();
	if (!chrome) return;
	const id = ++ownerSeq;
	$effect(() => {
		chrome.owner = id;
		chrome.crumbs = opts.crumbs?.() ?? null;
		chrome.actions = opts.actions?.() ?? null;
	});
	$effect(() => () => {
		if (chrome.owner === id) {
			chrome.crumbs = null;
			chrome.actions = null;
		}
	});
}
