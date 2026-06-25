import { getCellConnection, type Notebook } from '$lib/stores/notebook.svelte';
import { isBuiltinDuckDBConnection } from '$lib/types/connection';
import { extractFilterParams } from './markdoc-interp';

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
