import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { readFileSync, mkdirSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger, type Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { createWebSocketConnection } from 'vscode-ws-jsonrpc/server';
import type { IWebSocket } from 'vscode-ws-jsonrpc';
import { startLspForConnection } from './src/lib/server/sql-lsp-handler';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Tailwind v4 + vite-plugin-svelte compatibility fix:
// @tailwindcss/vite uses enforce:"pre" and intercepts any URL matching &lang.css.
// When a node_modules Svelte file (e.g. svelte-sonner/Toaster.svelte) has a <style> block,
// its virtual CSS URL (e.g. Toaster.svelte?svelte&type=style&lang.css) gets matched by
// tailwindcss before vite-plugin-svelte has compiled it, so tailwindcss receives the raw
// Svelte content instead of CSS. This load hook runs first and returns extracted CSS.
// We also strip Svelte's :global(...) wrapper — it's compiler syntax, not valid CSS,
// so the browser ignores any rule still using it (e.g. [data-sonner-toaster]).
const svelteNodeModulesStyleFix: Plugin = {
	name: 'svelte-node-modules-style-fix',
	enforce: 'pre',
	load(id) {
		if (id.includes('/node_modules/') && id.includes('.svelte') && id.includes('lang.css')) {
			const filePath = id.split('?')[0];
			try {
				const source = readFileSync(filePath, 'utf-8');
				const match = source.match(/<style[^>]*>([\s\S]*?)<\/style>/);
				const raw = match ? match[1] : '';
				// Strip :global(...) wrappers so the selectors become plain CSS.
				const css = raw.replace(/:global\(([^)]*)\)/g, '$1');
				return { code: css };
			} catch {
				return { code: '' };
			}
		}
	}
};

const DUCKDB_FILES = [
	'duckdb-mvp.wasm',
	'duckdb-eh.wasm',
	'duckdb-browser-mvp.worker.js',
	'duckdb-browser-eh.worker.js'
];

const duckdbStaticServe: Plugin = {
	name: 'duckdb-static-serve',
	buildStart() {
		// Copy DuckDB dist files to static/duckdb/ so they're served as CDN static assets
		// on Vercel (and any other static-file-capable host) without needing a server route.
		const staticDir = resolve(__dirname, 'static/duckdb');
		const distDir = resolve(__dirname, 'node_modules/@duckdb/duckdb-wasm/dist');
		mkdirSync(staticDir, { recursive: true });
		for (const file of DUCKDB_FILES) {
			copyFileSync(resolve(distDir, file), resolve(staticDir, file));
		}
	},
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			const match = req.url?.match(/^\/duckdb\/([^?#]+)/);
			if (match && DUCKDB_FILES.includes(match[1])) {
				const filePath = resolve(__dirname, 'node_modules/@duckdb/duckdb-wasm/dist', match[1]);
				try {
					const content = readFileSync(filePath);
					res.setHeader(
						'Content-Type',
						match[1].endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
					);
					res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
					// This middleware runs before Vite's internal middleware, so server.headers
					// is never applied here. The worker script needs COEP itself: a COEP-isolated
					// document refuses to spawn dedicated workers whose script lacks the header.
					res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
					res.end(content);
					return;
				} catch {
					// fall through
				}
			}
			next();
		});
	}
};

// `@duckdb/duckdb-wasm` cannot be loaded outside the browser: its Node entry
// crashes at import (reads `worker_threads.workerData`) and its browser entry
// references `Worker` at module scope. During the SSR build Vite loads the
// dependency to inspect its exports, which triggers that crash and fails the
// whole build. DuckDB is browser-only here (all call sites run in onMount /
// browser-guarded code), so we swap in a harmless stub for every non-client
// environment while the client bundle keeps the real package.
const duckdbSsrStub: Plugin = {
	name: 'duckdb-ssr-stub',
	enforce: 'pre',
	resolveId(id) {
		if (id === '@duckdb/duckdb-wasm' && this.environment?.name !== 'client') {
			return resolve(__dirname, 'src/lib/services/duckdb-ssr-stub.ts');
		}
	}
};

function toRpcSocket(ws: WebSocket): IWebSocket {
	return {
		send: (content) => ws.send(content),
		onMessage: (cb) => {
			ws.on('message', (data) => cb(data.toString()));
		},
		onError: (cb) => {
			ws.on('error', cb);
		},
		onClose: (cb) => {
			ws.on('close', (code, reason) => cb(code, reason.toString()));
		},
		dispose: () => ws.close()
	};
}

const sqlLspPlugin: Plugin = {
	name: 'sql-lsp',
	configureServer(server) {
		const wss = new WebSocketServer({ noServer: true });
		server.httpServer?.on('upgrade', (request, socket, head) => {
			if (request.url !== '/api/lsp') return;
			wss.handleUpgrade(request, socket as import('net').Socket, head, (ws) => {
				const rpcSocket = toRpcSocket(ws);
				const conn = createWebSocketConnection(rpcSocket);
				startLspForConnection(conn.reader, conn.writer);
			});
		});
	}
};

const viteLogger = createLogger();

export default defineConfig({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vite@8/vitest vite@7 Plugin type mismatch
	plugins: [
		sqlLspPlugin,
		duckdbStaticServe,
		duckdbSsrStub,
		svelteNodeModulesStyleFix,
		tailwindcss(),
		sveltekit()
	] as any,
	customLogger: {
		...viteLogger,
		warn(msg, options) {
			if (msg.includes('Failed to load source map for') && msg.includes('duckdb')) return;
			viteLogger.warn(msg, options);
		},
		warnOnce(msg, options) {
			if (msg.includes('Failed to load source map for') && msg.includes('duckdb')) return;
			viteLogger.warnOnce(msg, options);
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['e2e/**', 'src/**/*.integration.test.ts']
	},
	optimizeDeps: {
		// svelte-sonner contains .svelte.js files that use Svelte 5 runes ($state, $derived).
		// Vite's esbuild pre-bundler does not understand runes and strips the reactivity,
		// causing toast() calls to never trigger re-renders in the Toaster component.
		// Excluding it forces vite-plugin-svelte to handle it with the Svelte compiler.
		exclude: ['@duckdb/duckdb-wasm', 'layerchart', 'svelte-sonner'],
		include: [
			'prqlc > prqlc/dist/web/prqlc_js',
			'node-sql-parser/build/trino.js',
			'node-sql-parser/build/postgresql.js'
		]
	},
	assetsInclude: ['**/*.wasm'],
	server: {
		sourcemapIgnoreList(sourcePath) {
			return sourcePath.includes('duckdb') && sourcePath.includes('.map');
		},
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'credentialless'
		},
		// Docker Desktop's bind-mount file sharing (macOS/Windows) doesn't reliably forward
		// inotify events into the container, so chokidar's native watcher never fires.
		// Polling is the standard workaround — only enabled for the dockerized dev server
		// (see docker-compose.dev.yml), not local `pnpm dev`, since polling burns more CPU.
		watch: process.env.VITE_DOCKER_DEV ? { usePolling: true, interval: 300 } : undefined,
		// Vite's Host header check otherwise 403s any request whose Host isn't localhost —
		// the inngest container reaches this server via the Docker Compose service name
		// ("app"), so it must be allow-listed or Inngest's dev server can never sync/invoke
		// functions ("can't find your application" in the Inngest UI).
		allowedHosts: process.env.VITE_DOCKER_DEV ? ['app'] : undefined
	}
});
