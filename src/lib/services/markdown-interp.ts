import type { Cell } from '$lib/stores/notebook.svelte';

// Ref syntax:
//   {{outputName.count}}              → row count
//   {{outputName.rowCount}}           → row count (alias)
//   {{outputName.columns}}            → comma-separated column names
//   {{outputName.columnName}}         → first row, named column
//   {{outputName[N].columnName}}      → Nth row (negative ok), named column
//   {{outputName.columnName[N]}}      → Nth row, named column (column-first variant)
//   {{expr | round(N)}}               → arithmetic expression with round filter

const REF_RE = /\{\{([^}]+)\}\}/g;
// Simple ref: name[N].key  or  name.key  or  name.key[N]
const EXPR_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\[(-?\d+)\])?\.([a-zA-Z0-9_]+)(?:\[(-?\d+)\])?$/;
// Broader pattern for scanning refs inside compound expressions
const COMPOUND_REF_SRC =
	'([a-zA-Z_][a-zA-Z0-9_]*)(?:\\[(-?\\d+)\\])?\\.([a-zA-Z0-9_]+)(?:\\[(-?\\d+)\\])?';

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatValue(v: unknown): string {
	if (v === null || v === undefined) return '—';
	if (typeof v === 'number') return v.toLocaleString();
	return escapeHtml(String(v));
}

function resolveRow(
	rows: Record<string, unknown>[],
	idx1Str: string | undefined,
	idx2Str: string | undefined
): Record<string, unknown> | undefined {
	const rawIdx = idx2Str ?? idx1Str;
	if (rawIdx === undefined) return rows[0];
	let idx = parseInt(rawIdx, 10);
	if (idx < 0) idx = rows.length + idx;
	return rows[idx];
}

type RefResult = { value: unknown; error?: never } | { value?: never; error: string };

function resolveRefValue(
	name: string,
	idx1: string | undefined,
	key: string,
	idx2: string | undefined,
	cells: Cell[]
): RefResult {
	const cell = cells.find((c) => c.cellType === 'query' && c.outputName === name && c.result != null);
	if (!cell?.result) return { error: `⚡ ${name} not run` };
	const { rows, columns } = cell.result;

	if (key === 'count' || key === 'rowCount') return { value: rows.length };
	if (key === 'columns') return { value: columns.join(', ') };

	const row = resolveRow(rows, idx1, idx2);
	if (!row) {
		const rawIdx = idx2 ?? idx1 ?? '0';
		const idx = parseInt(rawIdx, 10) < 0 ? rows.length + parseInt(rawIdx, 10) : parseInt(rawIdx, 10);
		return { error: `row ${idx} missing` };
	}
	if (!(key in row)) return { error: `${key} not found` };
	return { value: row[key] };
}

function evaluateCompoundExpr(expr: string, cells: Cell[]): string {
	let rounder: ((n: number) => string) | null = null;
	const filterMatch = expr.match(/^([\s\S]*?)\|\s*round\((\d+)\)\s*$/);
	if (filterMatch) {
		expr = filterMatch[1].trim();
		const decimals = parseInt(filterMatch[2], 10);
		rounder = (n: number) => n.toFixed(decimals);
	}

	let errorSpan: string | null = null;
	const substituted = expr.replace(new RegExp(COMPOUND_REF_SRC, 'g'), (_, name, idx1, key, idx2) => {
		if (errorSpan) return '0';
		const res = resolveRefValue(name, idx1, key, idx2, cells);
		if ('error' in res) {
			errorSpan = `<span class="md-live-ref md-live-ref--missing">[? ${res.error}]</span>`;
			return '0';
		}
		if (typeof res.value === 'number') return String(res.value);
		errorSpan = `<span class="md-live-ref md-live-ref--missing">[? ${key} is not a number]</span>`;
		return '0';
	});

	if (errorSpan) return errorSpan;

	try {
		// eslint-disable-next-line no-new-func
		const result = Function(`'use strict'; return (${substituted})`)() as number;
		const formatted = rounder ? rounder(result) : result.toLocaleString();
		return `<span class="md-live-ref">${escapeHtml(formatted)}</span>`;
	} catch {
		return `<span class="md-live-ref md-live-ref--missing">[? eval error]</span>`;
	}
}

export function interpolateMarkdownRefs(markdown: string, cells: Cell[]): string {
	return markdown.replace(REF_RE, (_match, expr: string) => {
		const trimmed = expr.trim();
		const m = EXPR_RE.exec(trimmed);

		if (!m) return evaluateCompoundExpr(trimmed, cells);

		const [, name, idx1, key, idx2] = m;
		const res = resolveRefValue(name, idx1, key, idx2, cells);

		if ('error' in res) {
			return `<span class="md-live-ref md-live-ref--missing">[${res.error}]</span>`;
		}
		return `<span class="md-live-ref">${formatValue(res.value)}</span>`;
	});
}

/** Returns all outputName references found in a markdown string. */
export function extractMarkdownRefs(markdown: string): string[] {
	const names = new Set<string>();
	for (const [, expr] of markdown.matchAll(REF_RE)) {
		const trimmed = expr.trim();
		const m = EXPR_RE.exec(trimmed);
		if (m) {
			names.add(m[1]);
		} else {
			for (const [, name] of trimmed.matchAll(new RegExp(COMPOUND_REF_SRC, 'g'))) {
				names.add(name);
			}
		}
	}
	return [...names];
}
