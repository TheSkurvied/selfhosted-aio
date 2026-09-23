/** ntfy notifications (NTFY_URL). Best effort; never throws. */
import { env } from '../env';
import { log } from '../log';

/**
 * HTTP header values must be Latin-1 without CR/LF, but titles carry person
 * names. ntfy decodes RFC 2047 encoded-words, so send anything else that way.
 */
export function headerValue(v: string): string {
	const flat = v.replace(/[\r\n]+/g, ' ');
	return /^[\x20-\x7e]*$/.test(flat)
		? flat
		: `=?UTF-8?B?${Buffer.from(flat, 'utf8').toString('base64')}?=`;
}

export async function notify(title: string, message: string, tags: string[] = []): Promise<void> {
	let url: string | undefined;
	try {
		url = env.NTFY_URL;
	} catch {
		return;
	}
	if (!url) return;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				title: headerValue(title),
				...(tags.length ? { tags: tags.join(',') } : {}),
				'content-type': 'text/plain; charset=utf-8'
			},
			body: message,
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) log.warn('ntfy notification failed', { status: res.status });
	} catch (err) {
		log.warn('ntfy notification failed', { error: (err as Error).message });
	}
}
