import type { RequestHandler } from './$types';
import { getPythonJob } from '$lib/server/python-runner';

/**
 * SSE endpoint that streams live stdout/stderr for a running Python cell job,
 * plus the structured result (dataframe/figures/error) once it completes.
 *
 * Subscribe with: GET /api/python/logs?jobId=<id>
 *
 * Events:
 *   data: {"type":"line","text":"..."}
 *   data: {"type":"done","exitCode":0,"result":{"error":null,"figures":[],"dataframe":{...}}}
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const jobId = url.searchParams.get('jobId');
	if (!jobId) return new Response('jobId is required', { status: 400 });

	const job = getPythonJob(jobId);
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
				send({ type: 'done', exitCode, result: job!.result });
				try {
					controller.close();
				} catch {
					// ignore
				}
			}

			job.emitter.on('line', onLine);
			job.emitter.once('done', onDone);

			for (const line of job.lines) {
				send({ type: 'line', text: line });
			}

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
					// ignore
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
