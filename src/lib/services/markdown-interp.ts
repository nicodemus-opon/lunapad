import type { Cell } from '$lib/stores/notebook.svelte';

// Ref syntax:
//   {{outputName.count}}          → row count
//   {{outputName.columns}}        → comma-separated column names
//   {{outputName.columnName}}     → first row, named column
//   {{outputName[N].columnName}}  → Nth row (0-indexed), named column

const REF_RE = /\{\{([^}]+)\}\}/g;
// Matches: name[N].key  or  name.key
const EXPR_RE = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\[(\d+)\])?\.([a-zA-Z0-9_]+)$/;

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatValue(v: unknown): string {
	if (v === null || v === undefined) return '—';
	if (typeof v === 'number') return v.toLocaleString();
	return escapeHtml(String(v));
}

export function interpolateMarkdownRefs(markdown: string, cells: Cell[]): string {
	return markdown.replace(REF_RE, (_match, expr: string) => {
		const m = EXPR_RE.exec(expr.trim());
		if (!m) return `<span class="md-live-ref md-live-ref--missing">[? bad ref]</span>`;

		const [, name, idxStr, key] = m;
		const cell = cells.find(
			(c) => c.cellType === 'query' && c.outputName === name && c.result != null
		);

		if (!cell || !cell.result) {
			return `<span class="md-live-ref md-live-ref--missing">[⚡ ${name} not run]</span>`;
		}

		const { rows, columns } = cell.result;

		if (key === 'count') {
			return `<span class="md-live-ref">${rows.length.toLocaleString()}</span>`;
		}
		if (key === 'columns') {
			return `<span class="md-live-ref">${columns.join(', ')}</span>`;
		}

		const rowIdx = idxStr !== undefined ? parseInt(idxStr, 10) : 0;
		const row = rows[rowIdx];
		if (!row) {
			return `<span class="md-live-ref md-live-ref--missing">[? row ${rowIdx} missing]</span>`;
		}
		if (!(key in row)) {
			return `<span class="md-live-ref md-live-ref--missing">[? ${key} not found]</span>`;
		}

		return `<span class="md-live-ref">${formatValue(row[key])}</span>`;
	});
}

/** Returns all outputName references found in a markdown string. */
export function extractMarkdownRefs(markdown: string): string[] {
	const names = new Set<string>();
	for (const [, expr] of markdown.matchAll(REF_RE)) {
		const m = EXPR_RE.exec(expr.trim());
		if (m) names.add(m[1]);
	}
	return [...names];
}
