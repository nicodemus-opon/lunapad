// SSR / build-time stub for `@duckdb/duckdb-wasm`.
//
// The real package cannot be loaded outside the browser:
//   - its Node entry (`duckdb-node.cjs`) destructures `worker_threads.workerData`
//     at import time and throws when required on the main thread, which crashes
//     the Vite SSR build while it inspects the dependency's exports;
//   - its browser entry references `Worker` at module scope, so it also throws
//     when imported in Node.
//
// DuckDB only ever runs in the browser (every value use lives inside
// onMount / browser-guarded functions in `duckdb.ts`), so the server never
// needs a working implementation. This stub simply provides the namespace
// members so `import * as duckdb from '@duckdb/duckdb-wasm'` resolves during
// SSR; any accidental server-side invocation throws a clear error instead of a
// cryptic one. The real package is still used for the client bundle (see the
// `duckdb-ssr-stub` plugin in `vite.config.ts`).

const browserOnly = (): never => {
	throw new Error('@duckdb/duckdb-wasm is browser-only and is not available during SSR');
};

export class AsyncDuckDB {
	constructor() {
		browserOnly();
	}
}

export class ConsoleLogger {
	constructor() {
		browserOnly();
	}
}

export const LogLevel = { NONE: 0, DEBUG: 1, INFO: 2, WARNING: 3, ERROR: 4 } as const;

export const selectBundle = browserOnly;
