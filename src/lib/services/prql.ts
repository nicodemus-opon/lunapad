// Use the web dist — loads WASM via fetch, compatible with Vite 8.
// The bundler dist uses a static `import * as wasm from '.wasm'` (ESM WASM
// integration proposal) which Vite 8 does not support.
import initWasm, { compile, CompileOptions } from 'prqlc/dist/web/prqlc_js';
// Vite ?url import: gives us the hashed URL of the .wasm asset without
// trying to process it as a module.
import wasmUrl from 'prqlc/dist/web/prqlc_js_bg.wasm?url';
import { withTimeout } from '$lib/services/async';
import type { PRQLTarget } from '$lib/types/connection';

export interface PRQLError {
	kind: string;
	code: string | null;
	reason: string;
	hint: string | null;
	span: [number, number] | null;
	display: string | null;
	location: {
		start: [number, number];
		end: [number, number];
	} | null;
}

export interface CompileResult {
	sql: string | null;
	errors: PRQLError[];
}

function isPrqlStarter(line: string): boolean {
	return /^(prql\b|from\b|let\b|derive\b|select\b|filter\b|group\b|aggregate\b|sort\b|take\b|join\b)/i.test(
		line.trim()
	);
}

function isMarkdownBoundary(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) return false;
	return /^(#{1,6}\s|[-*+]\s|>\s|\d+\.\s|\*\*|__)/.test(trimmed);
}

function structuralDepthDelta(line: string): number {
	let delta = 0;
	let inSingle = false;
	let inDouble = false;
	let inBacktick = false;
	let escaped = false;

	for (const ch of line) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if ((inSingle || inDouble) && ch === '\\') {
			escaped = true;
			continue;
		}
		if (!inDouble && !inBacktick && ch === "'") {
			inSingle = !inSingle;
			continue;
		}
		if (!inSingle && !inBacktick && ch === '"') {
			inDouble = !inDouble;
			continue;
		}
		if (!inSingle && !inDouble && ch === '`') {
			inBacktick = !inBacktick;
			continue;
		}
		if (inSingle || inDouble || inBacktick) continue;
		if (ch === '(' || ch === '[' || ch === '{') delta += 1;
		if (ch === ')' || ch === ']' || ch === '}') delta -= 1;
	}

	return delta;
}

function extractFencedPrqlBlocks(query: string): string[] {
	const blocks: string[] = [];
	const fencePattern = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
	for (const match of query.matchAll(fencePattern)) {
		const language = match[1]?.trim().toLowerCase() ?? '';
		const body = match[2]?.trim() ?? '';
		if (!body) continue;
		if (language && language !== 'prql') continue;
		if (!body.split('\n').some((line) => isPrqlStarter(line))) continue;
		blocks.push(body);
	}
	return blocks;
}

export function sanitizePRQLInput(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) return trimmed;

	const fencedBlocks = extractFencedPrqlBlocks(query);
	if (fencedBlocks.length > 0) {
		return fencedBlocks.join('\n\n').trim();
	}

	const lines = query.split('\n');
	const startIdx = lines.findIndex((line) => isPrqlStarter(line));
	if (startIdx === -1) return trimmed;

	const kept: string[] = [];
	let depth = 0;
	for (let i = startIdx; i < lines.length; i++) {
		const line = lines[i];
		const trimmedLine = line.trim();

		if (
			kept.length > 0 &&
			depth <= 0 &&
			isMarkdownBoundary(trimmedLine) &&
			!isPrqlStarter(trimmedLine)
		) {
			break;
		}

		kept.push(line);
		depth = Math.max(0, depth + structuralDepthDelta(line));
	}

	return kept.join('\n').trim() || trimmed;
}

let _initialized = false;
let _initPromise: Promise<void> | null = null;

/** Call once during app startup (alongside initDB). Safe to call multiple times. */
export async function initPRQL(): Promise<void> {
	if (_initialized) return;
	if (_initPromise) return _initPromise;
	_initPromise = withTimeout(initWasm({ module_or_path: wasmUrl }), 'Initializing PRQL WASM').then(
		() => {
			_initialized = true;
		}
	);
	_initPromise = _initPromise.catch((err) => {
		_initPromise = null;
		throw err;
	});
	return _initPromise;
}

export function compilePRQL(query: string, target: PRQLTarget = 'sql.duckdb'): CompileResult {
	try {
		const normalizedQuery = sanitizePRQLInput(query);
		const opts = new CompileOptions();
		opts.target = target;
		opts.signature_comment = false;
		opts.format = true;
		const result = compile(normalizedQuery, opts);
		const sql = result ?? null;
		return { sql, errors: [] };
	} catch (err: unknown) {
		try {
			const parsed = JSON.parse((err as Error).message);
			const errors: PRQLError[] = (parsed.inner ?? [parsed]) as PRQLError[];
			return { sql: null, errors };
		} catch {
			return {
				sql: null,
				errors: [
					{
						kind: 'Error',
						code: null,
						reason: String(err),
						hint: null,
						span: null,
						display: String(err),
						location: null
					}
				]
			};
		}
	}
}
