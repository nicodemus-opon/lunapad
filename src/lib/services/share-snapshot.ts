import {
	getCellConnection,
	getExecutionCodeForTemplate,
	compilePRQLCached,
	type Cell,
	type CellDisplay,
	type CellLanguage,
	type CellType,
	type Notebook
} from '$lib/stores/notebook.svelte';
import {
	isBuiltinDuckDBConnection,
	getPRQLTargetForConnection,
	BUILTIN_DUCKDB_CONNECTION,
	type Connection
} from '$lib/types/connection';
import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';

import { extractBareMarkdocRefRoots, extractMarkdocRefs } from './markdoc-interp';

export type SharePublishRole = 'visible' | 'data';

export interface ShareCellSnapshot {
	id: string;
	cellType: CellType;
	outputName: string;
	display: CellDisplay;
	publishRole: SharePublishRole;
	language: CellLanguage;
	markdown: string;
	isLive: boolean;
	connectionId: string | null;
	frozenResult: Cell['result'] | null;
	sqlTemplate: string | null;
	resultChartConfig: ChartConfig | null;
	resultViewMode: ResultViewMode;
}

export interface ShareConnectionInput {
	connectionId: string;
	connection: Connection;
}

export interface ShareSnapshotResult {
	cells: ShareCellSnapshot[];
	reportView: boolean;
	connections: ShareConnectionInput[];
}

function connectionForCell(cell: Cell, connections: Connection[]): Connection {
	const id = cell.connectionId ?? BUILTIN_DUCKDB_CONNECTION.id;
	return connections.find((c) => c.id === id) ?? BUILTIN_DUCKDB_CONNECTION;
}

/**
 * Snapshots a notebook for publishing as a public report. Query cells on external
 * connections become "live" — their template SQL (CTEs inlined, ${param} filter tokens
 * left intact) is captured so the server can re-run them later with a viewer's own filter
 * choices. Query cells on the builtin DuckDB connection have no server-side data to re-run
 * against, so they're captured as a frozen snapshot of their last result instead.
 */
export function buildShareSnapshot(
	notebook: Notebook,
	connections: Connection[] = []
): ShareSnapshotResult {
	const resolvedConnections =
		connections.length > 0 ? connections : notebook.cells.map((c) => getCellConnection(c));
	const uniqueConnections = [...new Map(resolvedConnections.map((c) => [c.id, c])).values()];

	return buildShareSnapshotInternal(notebook, uniqueConnections);
}

function buildShareSnapshotInternal(
	notebook: Notebook,
	connections: Connection[]
): ShareSnapshotResult {
	const cells = notebook.cells;
	const connectionsById = new Map<string, ShareConnectionInput>();

	const markdocRefs = new Set<string>();
	for (const cell of cells) {
		if (cell.cellType !== 'markdown' || !cell.markdown?.trim()) continue;
		for (const ref of extractMarkdocRefs(cell.markdown)) markdocRefs.add(ref);
		for (const ref of extractBareMarkdocRefRoots(cell.markdown)) markdocRefs.add(ref);
	}

	const cellSnapshots: ShareCellSnapshot[] = cells.map((cell, idx) => {
		const publishRole: SharePublishRole =
			cell.cellType === 'query' &&
			cell.display !== 'collapsed' &&
			cell.outputName &&
			markdocRefs.has(cell.outputName)
				? 'data'
				: 'visible';

		const base = {
			id: cell.id,
			cellType: cell.cellType,
			outputName: cell.outputName,
			display: cell.display,
			publishRole,
			language: cell.language,
			markdown: cell.markdown,
			resultChartConfig: cell.resultChartConfig,
			resultViewMode: cell.resultViewMode
		};

		if (cell.cellType !== 'query') {
			return { ...base, isLive: false, connectionId: null, frozenResult: null, sqlTemplate: null };
		}

		const connection = connectionForCell(cell, connections);
		const isLive = !isBuiltinDuckDBConnection(connection);

		if (!isLive) {
			return {
				...base,
				isLive: false,
				connectionId: cell.connectionId,
				frozenResult: cell.result,
				sqlTemplate: null
			};
		}

		const templateCode = getExecutionCodeForTemplate(cells, idx);
		const sqlTemplate =
			cell.language === 'sql'
				? templateCode
				: compilePRQLCached(templateCode, getPRQLTargetForConnection(connection)).sql;

		if (!connectionsById.has(connection.id)) {
			connectionsById.set(connection.id, {
				connectionId: connection.id,
				connection
			});
		}

		return {
			...base,
			isLive: true,
			connectionId: cell.connectionId,
			frozenResult: null,
			sqlTemplate
		};
	});

	// Shares always render output-only, regardless of the owner's in-app reportView toggle —
	// viewers should never see raw editable code.
	return { cells: cellSnapshots, reportView: true, connections: [...connectionsById.values()] };
}
