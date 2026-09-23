/**
 * Generic OIDC login (authorization code + PKCE) via discovery, using arctic's
 * OAuth2Client. The ID token comes straight from the token endpoint over TLS,
 * so its claims are checked (iss, aud, exp, nonce) but its signature is not
 * (OIDC Core 3.1.3.7 allows this for the code flow).
 */
import type { Cookies } from '@sveltejs/kit';
import {
	CodeChallengeMethod,
	OAuth2Client,
	decodeIdToken,
	generateCodeVerifier,
	generateState
} from 'arctic';
import { eq } from 'drizzle-orm';
import { randomToken } from '../crypto';
import { db, t } from '../db';
import { env } from '../env';

type Discovery = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
};

const FLOW_COOKIE = 'aio_oidc';
const FLOW_TTL_SEC = 10 * 60;
let discoveryCache: { at: number; doc: Discovery } | null = null;

export async function discover(): Promise<Discovery> {
	if (discoveryCache && Date.now() - discoveryCache.at < 60 * 60 * 1000) return discoveryCache.doc;
	const issuer = env.OIDC_ISSUER!.replace(/\/+$/, '');
	const res = await fetch(`${issuer}/.well-known/openid-configuration`, {
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
	const doc = (await res.json()) as Partial<Discovery>;
	if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint)
		throw new Error('OIDC discovery document is missing required fields');
	discoveryCache = { at: Date.now(), doc: doc as Discovery };
	return discoveryCache.doc;
}

function client(): OAuth2Client {
	return new OAuth2Client(
		env.OIDC_CLIENT_ID!,
		env.OIDC_CLIENT_SECRET!,
		`${env.PUBLIC_URL}/auth/oidc/callback`
	);
}

/** Start the flow: returns the provider URL and stores state/verifier/nonce in a cookie. */
export async function beginOidc(cookies: Cookies): Promise<URL> {
	const d = await discover();
	const state = generateState();
	const verifier = generateCodeVerifier();
	const nonce = randomToken(16);
	const url = client().createAuthorizationURLWithPKCE(
		d.authorization_endpoint,
		state,
		CodeChallengeMethod.S256,
		verifier,
		['openid', 'email', 'profile']
	);
	url.searchParams.set('nonce', nonce);
	cookies.set(FLOW_COOKIE, JSON.stringify({ state, verifier, nonce }), {
		path: '/auth/oidc',
		httpOnly: true,
		secure: env.secureCookies,
		sameSite: 'lax',
		maxAge: FLOW_TTL_SEC
	});
	return url;
}

export class OidcError extends Error {}

/** Finish the flow: returns the verified { sub, email } or throws OidcError. */
export async function completeOidc(
	cookies: Cookies,
	params: URLSearchParams
): Promise<{ sub: string; email: string }> {
	const raw = cookies.get(FLOW_COOKIE);
	cookies.delete(FLOW_COOKIE, { path: '/auth/oidc' });
	if (!raw) throw new OidcError('Login session expired. Try again.');
	let flow: { state: string; verifier: string; nonce: string };
	try {
		flow = JSON.parse(raw);
	} catch {
		throw new OidcError('Login session invalid. Try again.');
	}
	if (params.get('error')) throw new OidcError('The identity provider refused the login.');
	const code = params.get('code');
	const state = params.get('state');
	if (!code || !state || state !== flow.state)
		throw new OidcError('Login state mismatch. Try again.');

	const d = await discover();
	let idToken: string;
	try {
		const tokens = await client().validateAuthorizationCode(d.token_endpoint, code, flow.verifier);
		idToken = tokens.idToken();
	} catch {
		throw new OidcError('Could not exchange the authorization code.');
	}
	const claims = decodeIdToken(idToken) as Record<string, unknown>;
	const aud = claims.aud;
	const audOk = Array.isArray(aud) ? aud.includes(env.OIDC_CLIENT_ID) : aud === env.OIDC_CLIENT_ID;
	if (claims.iss !== d.issuer || !audOk)
		throw new OidcError('ID token issuer or audience mismatch.');
	if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000)
		throw new OidcError('ID token expired.');
	if (claims.nonce !== flow.nonce) throw new OidcError('ID token nonce mismatch.');
	if (typeof claims.sub !== 'string' || !claims.sub)
		throw new OidcError('ID token has no subject.');
	if (typeof claims.email !== 'string') throw new OidcError('The identity provider sent no email.');
	if (claims.email_verified === false) throw new OidcError('Email address is not verified.');
	return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
}

/**
 * Map an OIDC identity to an admin row. Only ADMIN_EMAILS may log in; the row
 * is created on first login, or linked when a local admin has the same email.
 */
export async function adminForOidc(identity: {
	sub: string;
	email: string;
}): Promise<{ id: string; email: string; created: boolean } | null> {
	if (!env.adminEmails.includes(identity.email)) return null;
	const [bySub] = await db.select().from(t.admins).where(eq(t.admins.oidcSub, identity.sub));
	if (bySub) {
		// The sub is stable; the email must still be allowed (checked above).
		return { id: bySub.id, email: bySub.email, created: false };
	}
	const [byEmail] = await db.select().from(t.admins).where(eq(t.admins.email, identity.email));
	if (byEmail) {
		await db.update(t.admins).set({ oidcSub: identity.sub }).where(eq(t.admins.id, byEmail.id));
		return { id: byEmail.id, email: byEmail.email, created: false };
	}
	const [row] = await db
		.insert(t.admins)
		.values({ email: identity.email, oidcSub: identity.sub })
		.returning({ id: t.admins.id, email: t.admins.email });
	return { ...row, created: true };
}
