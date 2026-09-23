import type { RequestEvent } from '@sveltejs/kit';

/** Client IP as seen by adapter-node (set ADDRESS_HEADER/XFF_DEPTH behind Caddy). */
export function clientIp(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

export function requestMeta(event: Pick<RequestEvent, 'getClientAddress' | 'request'>) {
	return { ip: clientIp(event), userAgent: event.request.headers.get('user-agent') };
}
