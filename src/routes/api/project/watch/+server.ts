import type { RequestHandler } from './$types';
import fs from 'node:fs';
import { assertTenantProjectFolder } from '$lib/server/project-folders';

/**
 * SSE endpoint that streams `fs.watch` change events for a project folder.
 * The client subscribes once and receives a JSON event whenever any file
 * under the folder changes. The connection stays open until the client
 * disconnects (AbortSignal fires).
 *
 * Event format: `data: {"type":"change","filename":"models/orders.prql"}\n\n`
 */
export const GET: RequestHandler = async ({ url, request, locals }) => {
	const requestedFolder = url.searchParams.get('folder');
	if (!requestedFolder) {
		return new Response('folder is required', { status: 400 });
	}
	let folder: string;
	try {
		folder = assertTenantProjectFolder(locals, requestedFolder);
	} catch (err) {
		return new Response(err instanceof Error ? err.message : 'Invalid project folder', { status: 400 });
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

			// Heartbeat every 20s keeps Cloudflare / reverse proxies from killing
			// the idle SSE connection (otherwise ERR_QUIC_PROTOCOL_ERROR / closed).
			const heartbeat = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					clearInterval(heartbeat);
				}
			}, 20_000);

			function cleanup(watcher: ReturnType<typeof fs.watch> | null): void {
				clearInterval(heartbeat);
				try {
					watcher?.close();
				} catch {
					/* ignore */
				}
				try {
					controller.close();
				} catch {
					/* ignore */
				}
			}

			let watcher: ReturnType<typeof fs.watch> | null = null;
			try {
				// recursive watch is only supported on macOS/Windows; on Linux
				// (e.g. /app/projects Docker deploys) it throws — keep the
				// connection alive with heartbeats instead of closing instantly.
				const watchOpts: { recursive: boolean } =
					process.platform === 'darwin' || process.platform === 'win32'
						? { recursive: true }
						: { recursive: false };
				watcher = fs.watch(folder, watchOpts, (eventType, filename) => {
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
					cleanup(watcher);
				});
			} catch {
				// Watch unsupported (e.g. Linux recursive) — stay connected so the
				// client doesn't spin; heartbeats keep the socket alive.
				return;
			}

			// Clean up when client disconnects
			request.signal.addEventListener('abort', () => {
				cleanup(watcher);
			});
		},
		cancel() {
			try {
				// No direct watcher ref here; abort handler covers cleanup.
			} catch {
				/* ignore */
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
