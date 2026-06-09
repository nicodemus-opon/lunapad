import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED: Record<string, string> = {
	'duckdb-mvp.wasm': 'application/wasm',
	'duckdb-eh.wasm': 'application/wasm',
	'duckdb-browser-mvp.worker.js': 'text/javascript',
	'duckdb-browser-eh.worker.js': 'text/javascript',
};

// Resolved lazily so module-level code doesn't run during the SvelteKit build.
// Uses a dist file (not package.json) because the package has strict exports that
// don't expose './package.json'.
let duckdbDist: string | null = null;
function getDuckdbDist(): string {
	if (!duckdbDist) {
		const req = createRequire(import.meta.url);
		duckdbDist = dirname(req.resolve('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js'));
	}
	return duckdbDist;
}

export const GET: RequestHandler = ({ params }) => {
	const contentType = ALLOWED[params.file];
	if (!contentType) throw error(404);
	try {
		const body = readFileSync(join(getDuckdbDist(), params.file));
		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				'Cross-Origin-Resource-Policy': 'same-origin',
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		});
	} catch {
		throw error(404);
	}
};
