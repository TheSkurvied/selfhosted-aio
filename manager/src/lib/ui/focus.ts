const FOCUSABLE =
	'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusables(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(el) => !el.hasAttribute('inert') && el.getClientRects().length > 0
	);
}

/** Keeps Tab / Shift+Tab inside `root`. Returns true when it handled the event. */
export function trapTab(e: KeyboardEvent, root: HTMLElement): boolean {
	if (e.key !== 'Tab') return false;
	const els = focusables(root);
	if (els.length === 0) {
		e.preventDefault();
		root.focus();
		return true;
	}
	const first = els[0];
	const last = els[els.length - 1];
	const active = document.activeElement;
	if (e.shiftKey && (active === first || !root.contains(active))) {
		e.preventDefault();
		last.focus();
		return true;
	}
	if (!e.shiftKey && (active === last || !root.contains(active))) {
		e.preventDefault();
		first.focus();
		return true;
	}
	return false;
}
