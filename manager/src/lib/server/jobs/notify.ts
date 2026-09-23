/** ntfy notifications (NTFY_URL). Best effort; never throws. */
import { env } from '../env';
import { log } from '../log';

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
				title,
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
