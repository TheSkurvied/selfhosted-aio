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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * True for a state-changing request sent by a browser from another origin.
 *
 * SvelteKit's own CSRF check only covers form content types. A same-site page
 * (e.g. a sibling subdomain, which gets the SameSite=Lax cookie) can still send
 * a no-cors POST/PUT/DELETE with no Content-Type (a Blob body) or a JSON body to
 * /api/**, and the JSON routes parse the body regardless of Content-Type.
 * Browsers always send Origin on non-GET requests, so requests without it (curl,
 * scripts) are not cross-site browser requests.
 */
export function isCrossOriginMutation(request: Request, url: URL): boolean {
	if (SAFE_METHODS.has(request.method)) return false;
	const origin = request.headers.get('origin');
	if (origin !== null) return origin !== url.origin;
	const site = request.headers.get('sec-fetch-site');
	return site !== null && site !== 'same-origin' && site !== 'none';
}
