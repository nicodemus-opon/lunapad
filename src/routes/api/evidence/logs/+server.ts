import type { RequestHandler } from './$types';
import { getJob } from '$lib/server/evidence-runner';

export const GET: RequestHandler = async ({ url, request }) => {
	const jobId = url.searchParams.get('jobId');
	if (!jobId) return new Response('jobId is required', { status: 400 });

	const job = getJob(jobId);
	if (!job) return new Response('Job not found', { status: 404 });

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function send(data: object): void {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// closed
				}
			}

			let sentDone = false;

			function onLine(text: string): void {
				send({ type: 'line', text });
			}
			function onPort(port: number): void {
				send({ type: 'port', port });
			}
			function onDone(exitCode: number): void {
				if (sentDone) return;
				sentDone = true;
				send({ type: 'done', exitCode });
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			}

			job.emitter.on('line', onLine);
			job.emitter.on('port', onPort);
			job.emitter.once('done', onDone);

			// Replay buffered lines
			for (const line of job.lines) {
				send({ type: 'line', text: line });
			}
			// Replay port if already detected
			if (job.port !== null) {
				send({ type: 'port', port: job.port });
			}

			if (job.done) {
				onDone(job.exitCode ?? 0);
				return;
			}

			request.signal.addEventListener('abort', () => {
				job.emitter.off('line', onLine);
				job.emitter.off('port', onPort);
				job.emitter.off('done', onDone);
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
