import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { actorOf, api, body } from './api';
import { ServiceError } from './errors';

describe('api helper', () => {
	it('maps results and ServiceError statuses', async () => {
		const ok = await api(async () => ({ a: 1 }), 201);
		expect(ok.status).toBe(201);
		expect(await ok.json()).toEqual({ a: 1 });
		const nf = await api(async () => {
			throw new ServiceError('person not found', 404);
		});
		expect(nf.status).toBe(404);
		expect(await nf.json()).toEqual({ error: 'person not found' });
	});

	it('hides unexpected errors', async () => {
		const res = await api(async () => {
			throw new Error('db exploded with secret xyz');
		});
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'internal error' });
	});

	it('validates JSON bodies', async () => {
		const schema = z.object({ n: z.number() });
		const req = (t: string) => ({ request: new Request('http://x', { method: 'POST', body: t }) });
		expect(await body(req('{"n":1}'), schema)).toEqual({ n: 1 });
		await expect(body(req('{"n":"x"}'), schema)).rejects.toMatchObject({ status: 400 });
		await expect(body(req('not json'), schema)).rejects.toMatchObject({
			message: 'request body must be JSON'
		});
	});

	it('requires an admin', () => {
		expect(() => actorOf({ locals: { admin: null, sessionId: null } })).toThrow(ServiceError);
		expect(actorOf({ locals: { admin: { id: 'a1', email: 'x' }, sessionId: 's' } })).toBe('a1');
	});
});
