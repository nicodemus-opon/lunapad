import type { RequestHandler } from './$types';
import { getJob } from '$lib/server/dbt-runner';

/**
 * SSE endpoint that streams live log output for a running dbt job.
 *
 * Subscribe with: GET /api/dbt/logs?jobId=<id>
 *
 * Events:
 *   data: {"type":"line","text":"..."}
 *   data: {"type":"done","exitCode":0}
 */
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

			// Subscribe before replaying so no lines emitted during replay are missed.
			job.emitter.on('line', onLine);
			job.emitter.once('done', onDone);

			// Replay lines already emitted before this SSE connection was established.
			for (const line of job.lines) {
				send({ type: 'line', text: line });
			}

			// If the job already finished, fire done now.
			if (job.done) {
				onDone(job.exitCode ?? 0);
				return;
			}

			request.signal.addEventListener('abort', () => {
				job.emitter.off('line', onLine);
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
