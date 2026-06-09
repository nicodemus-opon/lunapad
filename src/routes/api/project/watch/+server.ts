import type { RequestHandler } from './$types';
import fs from 'node:fs';

/**
 * SSE endpoint that streams `fs.watch` change events for a project folder.
 * The client subscribes once and receives a JSON event whenever any file
 * under the folder changes. The connection stays open until the client
 * disconnects (AbortSignal fires).
 *
 * Event format: `data: {"type":"change","filename":"models/orders.prql"}\n\n`
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const folder = url.searchParams.get('folder');
	if (!folder) {
		return new Response('folder is required', { status: 400 });
	}

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function send(data: object): void {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					// controller closed
				}
			}

			// Send a heartbeat immediately so the client knows it's connected
			send({ type: 'connected' });

			let watcher: ReturnType<typeof fs.watch> | null = null;
			try {
				watcher = fs.watch(folder, { recursive: true }, (eventType, filename) => {
					if (!filename) return;
					const normalized = filename.replace(/\\/g, '/');

					// Manifest or run_results updated — tell the client to refresh models
					if (
						normalized === 'target/manifest.json' ||
						normalized === 'target/run_results.json'
					) {
						send({ type: 'manifest-changed' });
						return;
					}

					// Only react to .prql source file changes. Ignoring _models.yml,
					// compiled .sql, and other dbt artifacts prevents spurious reloads
					// during dbt runs that would wipe in-memory cell state.
					const parts = normalized.split('/');
					if (parts.some((p) => p.startsWith('.'))) return;
					if (!normalized.endsWith('.prql')) return;
					send({ type: eventType, filename: normalized });
				});

				watcher.on('error', () => {
					try { controller.close(); } catch { /* ignore */ }
				});
			} catch {
				try { controller.close(); } catch { /* ignore */ }
				return;
			}

			// Clean up when client disconnects
			request.signal.addEventListener('abort', () => {
				watcher?.close();
				try { controller.close(); } catch { /* ignore */ }
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
