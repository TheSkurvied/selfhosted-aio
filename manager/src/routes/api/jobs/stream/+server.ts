import * as s from '$lib/server/services';
import type { RequestHandler } from './$types';

/**
 * Server-sent events: one `job` event per job change (JobRow as JSON), plus a
 * comment heartbeat every 25 s. Optional `?ids=a,b` limits the stream to jobs.
 */
export const GET: RequestHandler = ({ url, request }) => {
	const only = new Set((url.searchParams.get('ids') ?? '').split(',').filter(Boolean));
	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (text: string) => {
				try {
					controller.enqueue(enc.encode(text));
				} catch {
					cleanup();
				}
			};
			send('retry: 3000\n\n');
			const unsubscribe = s.subscribeJobs((job) => {
				if (only.size && !only.has(job.id)) return;
				send(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
			});
			const heartbeat = setInterval(() => send(': ping\n\n'), 25_000);
			cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
				cleanup = () => {};
			};
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
