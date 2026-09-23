/**
 * Client helpers for `use:enhance` forms: toasts on success/failure, per-key busy state.
 *
 *   const busy = new Busy();
 *   <form method="POST" action="?/push" use:enhance={submitter(busy, 'push', { success: 'Push queued' })}>
 *   <Button loading={busy.is('push')} type="submit">Push</Button>
 */
import type { SubmitFunction } from '@sveltejs/kit';
import { applyAction } from '$app/forms';
import { toast } from '$lib/ui';

export class Busy {
	keys = $state<string[]>([]);
	is(key: string) {
		return this.keys.includes(key);
	}
	get any() {
		return this.keys.length > 0;
	}
	start(key: string) {
		this.keys = [...this.keys, key];
	}
	stop(key: string) {
		const i = this.keys.indexOf(key);
		if (i >= 0) this.keys = this.keys.toSpliced(i, 1);
	}
}

type Data = Record<string, unknown> | undefined;

export interface SubmitOptions {
	/** Toast text on success; `data.message` from the action wins when present. Empty = no toast. */
	success?: string | ((data: Data) => string);
	/** Called with the action's returned data after a success. */
	onsuccess?: (data: Data) => void;
	/** Called with the error message after a failure. Default: error toast. */
	onfailure?: (message: string) => void;
	/** Reset the form after success (default false: keep what the admin typed). */
	reset?: boolean;
	/** Re-run load functions after success (default true). */
	invalidate?: boolean;
	/** Return false to cancel (e.g. client-side validation). */
	before?: (input: { formData: FormData; cancel: () => void }) => void;
}

export function errorMessageOf(data: Data, fallback = 'Request failed'): string {
	const e = data?.error;
	return typeof e === 'string' && e ? e : fallback;
}

export function submitter(busy: Busy | null, key: string, opts: SubmitOptions = {}): SubmitFunction {
	return (input) => {
		opts.before?.(input);
		busy?.start(key);
		return async ({ result, update }) => {
			try {
				if (result.type === 'success') {
					const data = result.data as Data;
					const msg =
						typeof data?.message === 'string'
							? data.message
							: typeof opts.success === 'function'
								? opts.success(data)
								: opts.success;
					if (msg) toast.success(msg);
					opts.onsuccess?.(data);
					if (opts.invalidate !== false) await update({ reset: opts.reset ?? false });
				} else if (result.type === 'failure') {
					const m = errorMessageOf(result.data as Data);
					if (opts.onfailure) opts.onfailure(m);
					else toast.error(m);
				} else if (result.type === 'error') {
					const m = (result.error as { message?: string })?.message ?? 'Unexpected error';
					if (opts.onfailure) opts.onfailure(m);
					else toast.error(m);
				} else {
					await applyAction(result);
				}
			} finally {
				busy?.stop(key);
			}
		};
	};
}
