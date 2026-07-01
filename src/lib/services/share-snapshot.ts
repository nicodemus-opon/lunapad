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
	type Connection
} from '$lib/types/connection';
import type { ChartConfig, ResultViewMode } from '$lib/types/gui-pipeline';

export interface ShareCellSnapshot {
	id: string;
	cellType: CellType;
	outputName: string;
	display: CellDisplay;
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

/**
 * Snapshots a notebook for publishing as a public report. Query cells on external
 * connections become "live" — their template SQL (CTEs inlined, ${param} filter tokens
 * left intact) is captured so the server can re-run them later with a viewer's own filter
 * choices. Query cells on the builtin DuckDB connection have no server-side data to re-run
 * against, so they're captured as a frozen snapshot of their last result instead.
 */
export function buildShareSnapshot(notebook: Notebook): ShareSnapshotResult {
	const cells = notebook.cells;
	const connectionsById = new Map<string, ShareConnectionInput>();

	const cellSnapshots: ShareCellSnapshot[] = cells.map((cell, idx) => {
		const base = {
			id: cell.id,
			cellType: cell.cellType,
			outputName: cell.outputName,
			display: cell.display,
			language: cell.language,
			markdown: cell.markdown,
			resultChartConfig: cell.resultChartConfig,
			resultViewMode: cell.resultViewMode
		};

		if (cell.cellType !== 'query') {
			return { ...base, isLive: false, connectionId: null, frozenResult: null, sqlTemplate: null };
		}

		const connection = getCellConnection(cell);
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
