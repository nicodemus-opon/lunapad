import { getCellConnection, type Notebook } from '$lib/stores/notebook.svelte';
import { isBuiltinDuckDBConnection } from '$lib/types/connection';
import {
	extractFilterParams,
	extractMarkdocRefs,
	extractBareMarkdocRefRoots
} from './markdoc-interp';

const PARAM_TOKEN_PATTERN = /\$\{(\w+)\}/g;

function liveQueryCellParams(notebook: Notebook): Set<string> {
	const params = new Set<string>();
	for (const cell of notebook.cells) {
		if (cell.cellType !== 'query') continue;
		if (isBuiltinDuckDBConnection(getCellConnection(cell))) continue;
		for (const match of cell.code.matchAll(PARAM_TOKEN_PATTERN)) params.add(match[1]);
	}
	return params;
}

function declaredFilterParams(notebook: Notebook): Set<string> {
	const params = new Set<string>();
	for (const cell of notebook.cells) {
		if (cell.cellType !== 'markdown' || !cell.markdown) continue;
		for (const param of extractFilterParams(cell.markdown)) params.add(param);
	}
	return params;
}

/** `${param}` tokens in live (external-connection) query cells with no matching filter widget. */
export function findUnboundFilterTokens(notebook: Notebook): string[] {
	const declared = declaredFilterParams(notebook);
	return [...liveQueryCellParams(notebook)].filter((p) => !declared.has(p)).sort();
}

/** Filter widgets whose param matches no `${param}` in any live query cell. */
export function findOrphanedFilterWidgets(notebook: Notebook): string[] {
	const used = liveQueryCellParams(notebook);
	return [...declaredFilterParams(notebook)].filter((p) => !used.has(p)).sort();
}

/** Query cells referenced in Markdoc but still expanded (duplicate output on publish). */
export function findUncollapsedDataCells(notebook: Notebook): string[] {
	const refs = new Set<string>();
	for (const cell of notebook.cells) {
		if (cell.cellType !== 'markdown' || !cell.markdown?.trim()) continue;
		for (const ref of extractMarkdocRefs(cell.markdown)) refs.add(ref);
		for (const ref of extractBareMarkdocRefRoots(cell.markdown)) refs.add(ref);
	}
	return notebook.cells
		.filter(
			(c) =>
				c.cellType === 'query' &&
				c.display !== 'collapsed' &&
				c.outputName &&
				refs.has(c.outputName)
		)
		.map((c) => c.outputName)
		.sort();
}

/** Query cells with no result at publish time. */
export function findEmptyQueryResults(notebook: Notebook): string[] {
	return notebook.cells
		.filter((c) => c.cellType === 'query' && (!c.result || c.result.rows.length === 0))
		.map((c) => c.outputName || c.id)
		.sort();
}

/** Filters exist but upstream cells use frozen DuckDB snapshots. */
export function findDuckDBFilterWarnings(notebook: Notebook): boolean {
	if (declaredFilterParams(notebook).size === 0) return false;
	for (const cell of notebook.cells) {
		if (cell.cellType !== 'query') continue;
		if (!isBuiltinDuckDBConnection(getCellConnection(cell))) continue;
		if (cell.code.includes('${')) return true;
	}
	return false;
}
