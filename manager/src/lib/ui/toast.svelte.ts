export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
	id: number;
	message: string;
	kind: ToastKind;
	action?: { label: string; onclick: () => void };
}

export interface ToastOptions {
	kind?: ToastKind;
	/** Milliseconds; 0 keeps it until dismissed. Default 4000 (6000 for errors). */
	duration?: number;
	action?: { label: string; onclick: () => void };
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

class ToastStore {
	items = $state<ToastItem[]>([]);

	show(message: string, opts: ToastOptions = {}): number {
		const id = nextId++;
		const kind = opts.kind ?? 'info';
		this.items = [...this.items.slice(-3), { id, message, kind, action: opts.action }];
		const duration = opts.duration ?? (kind === 'error' ? 6000 : 4000);
		if (duration > 0) timers.set(id, setTimeout(() => this.dismiss(id), duration));
		return id;
	}

	dismiss(id: number) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();

/**
 * Show a toast (bottom center, dark pill).
 *   toast('Saved')
 *   toast.success('Pushed 4 configs')
 *   toast.error('Upstream returned 502')
 */
export const toast = Object.assign(
	(message: string, opts?: ToastOptions) => toasts.show(message, opts),
	{
		success: (message: string, opts?: Omit<ToastOptions, 'kind'>) =>
			toasts.show(message, { ...opts, kind: 'success' }),
		error: (message: string, opts?: Omit<ToastOptions, 'kind'>) =>
			toasts.show(message, { ...opts, kind: 'error' }),
		dismiss: (id: number) => toasts.dismiss(id)
	}
);
