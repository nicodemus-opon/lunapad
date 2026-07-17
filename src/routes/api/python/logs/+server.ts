import type { RequestHandler } from './$types';
import { getPythonJob } from '$lib/server/python-runner';
import { getCloudJob, type CloudJob } from '$lib/server/cloud-jobs';

const finalCloudStatuses = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toPythonResult(value: unknown): {
	error: string | null;
	missingModule?: string | null;
	figures: string[];
	dataframe: { rows: Record<string, unknown>[]; columns: string[] } | null;
} | null {
	if (!isRecord(value)) return null;
	const figures = Array.isArray(value.figures)
		? value.figures.filter((item) => typeof item === 'string')
		: [];
	const dataframe =
		isRecord(value.dataframe) &&
		Array.isArray(value.dataframe.rows) &&
		Array.isArray(value.dataframe.columns)
			? {
					rows: value.dataframe.rows.filter(isRecord),
					columns: value.dataframe.columns.filter((item) => typeof item === 'string')
				}
			: null;
	return {
		error: typeof value.error === 'string' ? value.error : null,
		missingModule:
			typeof value.missingModule === 'string' || value.missingModule === null
				? value.missingModule
				: null,
		figures,
		dataframe
	};
}

function resultForCloudJob(job: CloudJob): ReturnType<typeof toPythonResult> {
	const result = toPythonResult(job.result);
	if (result) return result;
	if (job.status === 'succeeded') {
		return { error: null, missingModule: null, figures: [], dataframe: null };
	}
	return {
		error: job.error ?? `Python job ${job.status}.`,
		missingModule: null,
		figures: [],
		dataframe: null
	};
}

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
export const GET: RequestHandler = async ({ url, request, locals }) => {
	const jobId = url.searchParams.get('jobId');
	if (!jobId) return new Response('jobId is required', { status: 400 });
	const requestedJobId = jobId;

	const job = getPythonJob(requestedJobId);
	if (!job) {
		if (!locals.user || !locals.organization) return new Response('Unauthorized', { status: 401 });
		const cloudJob = await getCloudJob({ orgId: locals.organization.id, jobId: requestedJobId });
		if (!cloudJob || cloudJob.kind !== 'python')
			return new Response('Job not found', { status: 404 });

		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				let logOffset = 0;
				let closed = false;
				let polling = false;
				let timer: ReturnType<typeof setInterval> | undefined;

				function send(data: object): void {
					if (closed) return;
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
					} catch {
						closed = true;
					}
				}

				function close(): void {
					if (closed) return;
					closed = true;
					if (timer) clearInterval(timer);
					try {
						controller.close();
					} catch {
						// ignore
					}
				}

				async function poll(): Promise<void> {
					if (polling || closed) return;
					polling = true;
					try {
						const latest = await getCloudJob({
							orgId: locals.organization!.id,
							jobId: requestedJobId
						});
						if (!latest) {
							send({
								type: 'done',
								exitCode: -1,
								result: {
									error: 'Python job was no longer available.',
									figures: [],
									dataframe: null
								}
							});
							close();
							return;
						}
						const logs = latest.logs ?? '';
						if (logs.length > logOffset) {
							const chunk = logs.slice(logOffset);
							logOffset = logs.length;
							for (const line of chunk.split(/\r?\n/)) {
								if (line) send({ type: 'line', text: line });
							}
						}
						if (finalCloudStatuses.has(latest.status)) {
							const result = resultForCloudJob(latest);
							send({
								type: 'done',
								exitCode: latest.status === 'succeeded' && !result?.error ? 0 : 1,
								result
							});
							close();
						}
					} catch (err) {
						send({
							type: 'done',
							exitCode: -1,
							result: {
								error: err instanceof Error ? err.message : 'Failed to read Python job logs.',
								figures: [],
								dataframe: null
							}
						});
						close();
					} finally {
						polling = false;
					}
				}

				void poll();
				timer = setInterval(() => void poll(), 1000);
				request.signal.addEventListener('abort', close, { once: true });
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	}

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
