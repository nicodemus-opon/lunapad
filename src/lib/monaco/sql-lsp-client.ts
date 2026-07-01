/**
 * Browser-side SQL LSP client.
 * Connects to the in-process LSP at ws://.../api/lsp (served by the Vite plugin)
 * and registers it with Monaco for trinosql, genericsql, and sql language IDs.
 *
 * Only initialises once; silently no-ops if the LSP WebSocket is unavailable
 * (e.g. in production without the plugin).
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';

const SQL_LANGUAGE_IDS = ['trinosql', 'genericsql', 'sql'];

let started = false;

export function startSqlLspClient(_monaco: typeof Monaco): void {
	if (started) return;
	started = true;

	function connect() {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const ws = new WebSocket(`${proto}://${location.host}/api/lsp`);

		ws.addEventListener('open', () => {
			const socket = toSocket(ws);
			const reader = new WebSocketMessageReader(socket);
			const writer = new WebSocketMessageWriter(socket);

			const client = new MonacoLanguageClient({
				name: 'SQL LSP',
				clientOptions: {
					documentSelector: SQL_LANGUAGE_IDS.map((language) => ({ language })),
					errorHandler: {
						error: () => ({ action: 1 /* Continue */ }),
						closed: () => ({ action: 2 /* DoNotRestart */ })
					}
				},
				messageTransports: { reader, writer }
			});

			client.start();

			reader.onClose(() => {
				client.stop();
				if (!document.hidden) setTimeout(connect, 3000);
			});
		});

		ws.addEventListener('error', () => {
			// LSP unavailable — fail silently
		});
	}

	connect();
}
