/** Formatting helpers used by (app) pages and the share page (client + server safe). */

export const KIND_LABEL = { aiostreams: 'AIOStreams', aiometadata: 'AIOMetadata' } as const;
export const KIND_SHORT = { aiostreams: 'Streams', aiometadata: 'Metadata' } as const;
export type KindName = keyof typeof KIND_LABEL;

function toDate(d: Date | string | number | null | undefined): Date | null {
	if (d === null || d === undefined || d === '') return null;
	const x = d instanceof Date ? d : new Date(d);
	return Number.isNaN(x.getTime()) ? null : x;
}

/** "Sep 20, 2026" */
export function fmtDate(d: Date | string | number | null | undefined, empty = '-'): string {
	const x = toDate(d);
	return x ? x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : empty;
}

/** "Sep 20, 2026, 09:12" */
export function fmtDateTime(d: Date | string | number | null | undefined, empty = '-'): string {
	const x = toDate(d);
	if (!x) return empty;
	return `${fmtDate(x)}, ${x.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "3 min ago", "in 2 days" */
export function fmtRelative(d: Date | string | number | null | undefined, empty = 'Never'): string {
	const x = toDate(d);
	if (!x) return empty;
	const diff = x.getTime() - Date.now();
	const abs = Math.abs(diff);
	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		['year', 365 * 864e5],
		['month', 30 * 864e5],
		['day', 864e5],
		['hour', 36e5],
		['minute', 6e4]
	];
	for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
	return abs < 45e3 ? 'just now' : rtf.format(Math.round(diff / 1000), 'second');
}

export function fmtDuration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	return `${Math.round(ms / 60_000)} min`;
}

export function shortId(id: string | null | undefined): string {
	if (!id) return '-';
	return id.length > 12 ? `${id.slice(0, 4)}...${id.slice(-3)}` : id;
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** Friendly label for audit actions like "template.version" -> "Template version". */
export function actionLabel(action: string): string {
	const s = action.replace(/[._]/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}
