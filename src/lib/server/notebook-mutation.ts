import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { compile as compilePrql, CompileOptions } from 'prqlc/dist/node/prqlc_js';
import type {
	Cell,
	CellLanguage,
	CellMaterializationMode,
	CellType,
	Notebook
} from '$lib/stores/notebook.svelte';
import type { ChartConfig } from '$lib/types/gui-pipeline';
import { deconflictName } from '$lib/utils/deconflict';
import {
	assertAllowedProjectFolder,
	walkProjectDirectory,
	writeProjectFile
} from '$lib/server/project.js';
import { getConnectionMetadata, listConnectionsMetadata } from '$lib/server/connections-store.js';
import { getSecret } from '$lib/server/connection-secrets.js';
import { queryExternalConnection, fetchExternalConnectionSchema } from '$lib/server/connections.js';
import { spawnPythonCell, getPythonJob, type PythonRunResult } from '$lib/server/python-runner.js';
import { serializeLunaFile, type SerializableCell } from '$lib/services/luna-file.js';
import { cellsToPmDocument, pmDocumentToBlocks } from '$lib/services/notebook-pm.js';
import { normalizePmNodeIds, type PMDocJSON } from '$lib/services/markdoc-pm.js';
import {
	buildSQLExecutionCode,
	resolvePythonDataRefs,
	resolvePlotDataRefs
} from '$lib/services/cell-deps.js';
import {
	compileNotebookBlueprint,
	applyNotebookPatchOperations,
	validateNotebookPmDocument,
	type NotebookBlueprint,
	type NotebookBlueprintDiagnostic,
	type NotebookExecutableBlueprint,
	type NotebookPatchOperation
} from '$lib/services/notebook-blueprint.js';
import {
	codeReferencesUnknownTable,
	type ChatToolPolicyContext
} from '$lib/agent/server/chat-tool-policy.js';
import { assertCloudTenantRef, type TenantRef } from './tenancy.js';

/**
 * Server-side bridge between the (already isomorphic) blueprint/PM-document compiler
 * and `.luna` files on disk — the piece the AI chat agent never needed, since it
 * mutates the in-browser Svelte store instead. MCP/API notebook tools go through
 * this module exclusively so on-disk `.luna` notebooks stay the single source of
 * truth for both surfaces (matching lunapad-actions.ts's existing "same source of
 * truth, no duplicated logic" principle for the rest of the MCP/API tool surface).
 */

// ── Handle ───────────────────────────────────────────────────────────────────

export interface ServerNotebookHandle {
	folder: string;
	notebookId: string;
	/** Absolute path to the `.luna` file. Only meaningful when `isLuna` is true. */
	filePath: string;
	isLuna: boolean;
	cells: Cell[];
	document: PMDocJSON;
	knownRefs: Set<string>;
	knownCellIds: Set<string>;
}

function lunaRelPath(notebookId: string): string {
	return `${notebookId}.luna`;
}

export async function loadServerNotebookHandle(
	folder: string,
	notebookId: string
): Promise<ServerNotebookHandle> {
	assertAllowedProjectFolder(folder);
	const { notebooks } = await walkProjectDirectory(folder);
	const notebook = notebooks.find((n) => n.id === notebookId);
	if (!notebook) throw new Error(`Notebook "${notebookId}" not found.`);
	const isLuna = notebook.format === 'luna';
	return {
		folder,
		notebookId,
		filePath: path.join(folder, lunaRelPath(notebookId)),
		isLuna,
		cells: notebook.cells,
		// Normalized here (not left to applyNotebookPatchOperations' own internal
		// normalization) so inspect_notebook can show an agent the SAME nodeIds that
		// operations-based patches will actually match against — normalizePmNodeIds is
		// content-hash-deterministic, so calling it here and again inside
		// applyNotebookPatchOperations is redundant but harmless, not a divergence risk.
		document: normalizePmNodeIds(cellsToPmDocument(notebook.cells)),
		knownRefs: new Set(notebook.cells.map((c) => c.outputName).filter(Boolean)),
		knownCellIds: new Set(notebook.cells.map((c) => c.id))
	};
}

async function getNotebookById(folder: string, notebookId: string): Promise<Notebook | undefined> {
	const { notebooks } = await walkProjectDirectory(folder);
	return notebooks.find((n) => n.id === notebookId);
}

async function notebookExists(folder: string, notebookId: string): Promise<boolean> {
	return (await getNotebookById(folder, notebookId)) !== undefined;
}

// ── Cell <-> SerializableCell bridging ──────────────────────────────────────

/** Extra, MCP-only fields on top of NotebookExecutableBlueprint — the blueprint
 *  type doesn't carry a connectionId/materializeMode (the AI chat's client-side
 *  executor pulls those from app state instead), but a headless caller has no
 *  app state to pull them from, so MCP's tool schema accepts them explicitly. */
export interface McpExecutableCellInput extends NotebookExecutableBlueprint {
	connectionId?: string | null;
	materializeMode?: CellMaterializationMode;
}

function cellToSerializableCell(cell: Cell): SerializableCell {
	return {
		id: cell.id,
		cellType: cell.cellType,
		markdown: cell.markdown,
		markdownEditMode: cell.markdownEditMode,
		udfBody: cell.udfBody,
		outputName: cell.outputName,
		language: cell.language,
		code: cell.code,
		connectionId: cell.connectionId,
		materializeMode: cell.materializeMode,
		dbtSchema: cell.dbtSchema,
		dbtTags: cell.dbtTags,
		editMode: cell.editMode,
		resultViewMode: cell.resultViewMode,
		resultChartConfig: cell.resultChartConfig,
		plotMode: cell.plotMode,
		plotConfig: cell.plotConfig,
		plotSourceCellId: cell.plotSourceCellId,
		columnFormatRules: cell.columnFormatRules,
		columnWidths: cell.columnWidths,
		guiStages: cell.guiStages,
		display: cell.display,
		hideResult: cell.hideResult,
		hideInReport: cell.hideInReport,
		stageResultsCollapsed: cell.stageResultsCollapsed,
		scheduleEnabled: cell.scheduleEnabled,
		scheduleIntervalMinutes: cell.scheduleIntervalMinutes,
		scheduleScope: cell.scheduleScope,
		promotedModelPath: cell.promotedModelPath
	};
}

function markdownSerializableCell(markdown: string, id: string): SerializableCell {
	return {
		id,
		cellType: 'markdown',
		markdown,
		udfBody: '',
		outputName: '',
		language: 'prql',
		code: '',
		connectionId: null,
		materializeMode: 'table',
		dbtSchema: null,
		dbtTags: [],
		editMode: 'gui',
		resultViewMode: 'table',
		resultChartConfig: null,
		plotMode: 'code',
		plotConfig: null,
		plotSourceCellId: null,
		columnFormatRules: {},
		columnWidths: {},
		guiStages: [],
		display: 'full',
		hideResult: false,
		hideInReport: false,
		stageResultsCollapsed: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell'
	};
}

function newExecutableSerializableCell(
	cellId: string,
	outputName: string,
	bp: McpExecutableCellInput
): SerializableCell {
	const cellType: Extract<CellType, 'query' | 'python' | 'plot'> = bp.cellType ?? 'query';
	const language: CellLanguage = bp.language ?? 'prql';
	return {
		id: cellId,
		cellType,
		markdown: '',
		udfBody: '',
		outputName,
		language,
		code: bp.code,
		connectionId: cellType === 'query' ? (bp.connectionId ?? null) : null,
		materializeMode: bp.materializeMode ?? 'table',
		dbtSchema: null,
		dbtTags: [],
		editMode: language === 'sql' ? 'prql' : 'gui',
		resultViewMode: 'table',
		resultChartConfig: null,
		plotMode: 'code',
		plotConfig: null,
		plotSourceCellId: null,
		columnFormatRules: {},
		columnWidths: {},
		guiStages: [{ type: 'from', table: '' }],
		display: 'full',
		hideResult: false,
		hideInReport: false,
		stageResultsCollapsed: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell'
	};
}

function diagnostic(path: string, message: string): NotebookBlueprintDiagnostic {
	return { path, message };
}

function finalOutputName(
	bp: McpExecutableCellInput | undefined,
	existing: Cell | undefined,
	cellId: string
): string {
	return bp?.outputName || existing?.outputName || cellId;
}

function validateCellPlacements(
	document: PMDocJSON,
	executableCells: McpExecutableCellInput[],
	existingCells: Cell[]
): NotebookBlueprintDiagnostic[] {
	const blocks = pmDocumentToBlocks(document).filter((b) => b.kind === 'query');
	const executableByCellId = new Map<string, McpExecutableCellInput>();
	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	for (const cell of executableCells) {
		if (executableByCellId.has(cell.cellId)) {
			diagnostics.push(
				diagnostic(
					`executableCells.${cell.cellId}`,
					`Duplicate executable cellId "${cell.cellId}". Cell ids must be stable and unique.`
				)
			);
		}
		executableByCellId.set(cell.cellId, cell);
	}

	const existingById = new Map(existingCells.map((c) => [c.id, c]));
	const seenCellIds = new Set<string>();
	const seenOutputNames = new Map<string, string>();
	for (const block of blocks) {
		if (seenCellIds.has(block.cellId)) {
			diagnostics.push(
				diagnostic(
					`blocks.${block.cellId}`,
					`Cell "${block.cellId}" is placed more than once in the notebook document.`
				)
			);
			continue;
		}
		seenCellIds.add(block.cellId);
		const bp = executableByCellId.get(block.cellId);
		const existing = existingById.get(block.cellId);
		if (!bp && !existing) continue;
		const outputName = finalOutputName(bp, existing, block.cellId);
		const priorCellId = seenOutputNames.get(outputName);
		if (priorCellId && priorCellId !== block.cellId) {
			diagnostics.push(
				diagnostic(
					`executableCells.${block.cellId}.outputName`,
					`Duplicate outputName "${outputName}" used by cells "${priorCellId}" and "${block.cellId}". Output names are composable data refs and must be unique.`
				)
			);
		} else {
			seenOutputNames.set(outputName, block.cellId);
		}
	}
	return diagnostics;
}

/**
 * Walks a compiled/patched PM document's blocks (markdown runs + queryBlock
 * placements, in document order — same shape the browser store's
 * `syncNotebookFromPmDocument` consumes) into the flat `SerializableCell[]`
 * `serializeLunaFile` expects. A queryBlock's `cellId` is resolved against
 * `existingCells` first (patching a cell already on disk, preserving its
 * connection/chart/materialize meta), then against `executableCells` (a brand
 * new cell introduced by this create/patch call).
 */
function pmDocumentToSerializableCells(
	document: PMDocJSON,
	executableCells: McpExecutableCellInput[],
	existingCells: Cell[]
): SerializableCell[] {
	const blocks = pmDocumentToBlocks(document);
	const executableByCellId = new Map(executableCells.map((c) => [c.cellId, c]));
	const existingById = new Map(existingCells.map((c) => [c.id, c]));

	const out: SerializableCell[] = [];
	let markdownIndex = 0;
	for (const block of blocks) {
		if (block.kind === 'markdown') {
			out.push(markdownSerializableCell(block.markdown, block.cellId ?? `md_${markdownIndex++}`));
			continue;
		}
		if (block.kind === 'page') {
			out.push(markdownSerializableCell(`# ${block.title}`, `md_${markdownIndex++}`));
			continue;
		}
		// block.kind === 'query' (queryBlock placement — query/python/plot/udf cell)
		const existing = existingById.get(block.cellId);
		const bp = executableByCellId.get(block.cellId);
		if (existing) {
			const outputName = finalOutputName(bp, existing, block.cellId);
			out.push(
				cellToSerializableCell(
					bp
						? {
								...existing,
								outputName,
								code: bp.code,
								language: bp.language ?? existing.language,
								connectionId:
									bp.connectionId !== undefined ? bp.connectionId : existing.connectionId,
								materializeMode: bp.materializeMode ?? existing.materializeMode
							}
						: existing
				)
			);
			continue;
		}
		if (!bp) {
			throw new Error(
				`Block references cell "${block.cellId}", which is neither an existing cell in this notebook nor present in executableCells.`
			);
		}
		const outputName = bp.outputName || block.cellId;
		out.push(newExecutableSerializableCell(block.cellId, outputName, bp));
	}
	return out;
}

async function commitDocumentToLunaFile(
	folder: string,
	notebookId: string,
	document: PMDocJSON,
	executableCells: McpExecutableCellInput[],
	existingCells: Cell[]
): Promise<Notebook> {
	const cells = pmDocumentToSerializableCells(document, executableCells, existingCells);
	const content = serializeLunaFile(cells);
	await writeProjectFile(folder, lunaRelPath(notebookId), content);
	const notebook = await getNotebookById(folder, notebookId);
	if (!notebook) throw new Error(`Wrote "${notebookId}.luna" but could not re-read it back.`);
	return notebook;
}

/**
 * Reuses chat-tool-policy.ts's unknown-table check (the same guardrail the AI
 * chat's SSE route applies to create_cell/update_cell) against every new query
 * cell's SQL/PRQL, instead of re-implementing it — see buildMcpToolPolicyContext.
 * Returns diagnostics (repairable, not a thrown exception) so a headless caller
 * gets the same "here's what's wrong, fix it and retry" shape as a real compile
 * error, rather than a table typo silently reaching an external connection.
 *
 * Unlike the AI chat's version (which reads schema the client already fetched
 * into app state), MCP has no cached schema — a query cell's FROM table is
 * almost always a real warehouse table, not another cell's output, so this
 * fetches live schema per distinct connectionId referenced. A schema fetch
 * failure (bad credentials, unreachable host, etc.) degrades to "skip the
 * check for that connection's cells" rather than blocking the whole call —
 * the query will still fail loudly at run_query_nodes time if the table
 * really doesn't exist, so failing open here doesn't hide a real problem.
 */
async function checkExecutableCellTables(
	executableCells: McpExecutableCellInput[],
	existingCells: Cell[],
	tenant?: TenantRef | null
): Promise<NotebookBlueprintDiagnostic[]> {
	const known = new Set(existingCells.map((c) => c.outputName).filter(Boolean));
	for (const c of executableCells) known.add(c.outputName);

	const queryCells = executableCells.filter(
		(c) => (c.cellType ?? 'query') === 'query' && c.code.trim()
	);
	const connectionIds = [
		...new Set(queryCells.map((c) => c.connectionId).filter((id): id is string => !!id))
	];
	const schemaByConnection = new Map<string, Set<string>>();
	const connectionDiagnostics: NotebookBlueprintDiagnostic[] = [];
	await Promise.all(
		connectionIds.map(async (connectionId) => {
			// A connectionId that doesn't resolve at all (typo, revoked connection) is a real,
			// actionable caller mistake — surface it directly rather than failing open, unlike a
			// transient fetch error against a connection that DOES exist (network hiccup, bad
			// creds) where failing open is the safer default (see doc comment above).
			const connection = await getConnectionMetadata(connectionId, tenant?.orgId);
			if (!connection) {
				connectionDiagnostics.push({
					path: `executableCells.connectionId`,
					message: `Unknown connection id "${connectionId}". Use list_connections to see available connections.`
				});
				return;
			}
			if (connection.type === 'duckdb-wasm') {
				connectionDiagnostics.push({
					path: `executableCells.connectionId`,
					message:
						'The built-in DuckDB connection runs in-browser only and cannot be targeted via MCP/API — use an external connection.'
				});
				return;
			}
			try {
				const secret = await getSecret(connection.id, tenant?.orgId);
				const { tables } = await fetchExternalConnectionSchema(
					connection,
					secret ?? undefined,
					tenant?.orgId
				);
				schemaByConnection.set(
					connectionId,
					new Set(
						tables.flatMap((t) => [
							t.name,
							t.schema ? `${t.schema}.${t.name}` : t.name,
							t.name.split('.').pop() ?? t.name
						])
					)
				);
			} catch {
				// Transient schema-fetch failure against a real connection — fail open.
			}
		})
	);
	if (connectionDiagnostics.length) return connectionDiagnostics;

	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	for (const cell of queryCells) {
		const schemaTableNames = new Set([
			...known,
			...(cell.connectionId ? (schemaByConnection.get(cell.connectionId) ?? []) : [])
		]);
		// No live schema was resolvable for this cell's connection (fetch failed, or no
		// connectionId set yet) — fail open rather than reject every base-table query.
		if (cell.connectionId && !schemaByConnection.has(cell.connectionId)) continue;
		const ctx: ChatToolPolicyContext = {
			schemaTableNames,
			cellOutputNames: known,
			latestUserMessage: ''
		};
		const unknown = codeReferencesUnknownTable(cell.code, ctx);
		if (unknown) {
			diagnostics.push({
				path: `executableCells.${cell.cellId}`,
				message: `Cell "${cell.outputName}" references "${unknown}", which is not a known table on connection "${cell.connectionId}" or a cell output. Available cell outputs: ${[...known].join(', ') || '(none)'}.`
			});
		}
	}
	return diagnostics;
}

// ── Create / patch / validate ───────────────────────────────────────────────

export interface NotebookMutationResult {
	diagnostics: NotebookBlueprintDiagnostic[];
	notebook?: Notebook;
}

export async function createNotebookFromBlueprintOnDisk(
	folder: string,
	notebookId: string,
	blueprint: NotebookBlueprint & { executableCells?: McpExecutableCellInput[] },
	tenant?: TenantRef | null
): Promise<NotebookMutationResult> {
	assertAllowedProjectFolder(folder);
	if (await notebookExists(folder, notebookId)) {
		return {
			diagnostics: [
				{
					path: 'notebookId',
					message: `A notebook already exists at "${notebookId}". Use apply_notebook_patch to edit it.`
				}
			]
		};
	}
	const compiled = compileNotebookBlueprint(blueprint);
	if (!compiled.document) return { diagnostics: compiled.diagnostics };
	const placementDiagnostics = validateCellPlacements(
		compiled.document,
		(blueprint.executableCells as McpExecutableCellInput[]) ?? [],
		[]
	);
	if (placementDiagnostics.length) return { diagnostics: placementDiagnostics };
	const tableDiagnostics = await checkExecutableCellTables(
		(blueprint.executableCells as McpExecutableCellInput[]) ?? [],
		[],
		tenant
	);
	if (tableDiagnostics.length) return { diagnostics: tableDiagnostics };
	const notebook = await commitDocumentToLunaFile(
		folder,
		notebookId,
		compiled.document,
		(blueprint.executableCells as McpExecutableCellInput[]) ?? [],
		[]
	);
	return { diagnostics: [], notebook };
}

export interface NotebookPatchInput {
	blueprint?: NotebookBlueprint;
	document?: PMDocJSON;
	operations?: NotebookPatchOperation[];
	executableCells?: McpExecutableCellInput[];
	title?: string;
}

function slugify(title: string): string {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || 'untitled';
}

async function renameLunaNotebook(
	folder: string,
	notebookId: string,
	title: string
): Promise<Notebook> {
	const oldFilePath = path.join(folder, lunaRelPath(notebookId));
	const dirRel = path.dirname(notebookId);
	const { notebooks } = await walkProjectDirectory(folder);
	const siblingBaseNames = new Set(
		notebooks
			.filter((n) => n.format === 'luna' && n.id !== notebookId && path.dirname(n.id) === dirRel)
			.map((n) => path.basename(n.id))
	);
	const newBase = deconflictName(siblingBaseNames, slugify(title));
	const newNotebookId = dirRel === '.' ? newBase : `${dirRel}/${newBase}`;
	if (newNotebookId !== notebookId) {
		const newFilePath = path.join(folder, lunaRelPath(newNotebookId));
		await fs.mkdir(path.dirname(newFilePath), { recursive: true });
		await fs.rename(oldFilePath, newFilePath);
	}
	const notebook = await getNotebookById(folder, newNotebookId);
	if (!notebook)
		throw new Error(`Renamed to "${newNotebookId}.luna" but could not re-read it back.`);
	return notebook;
}

export async function patchNotebookOnDisk(
	folder: string,
	notebookId: string,
	patch: NotebookPatchInput,
	tenant?: TenantRef | null
): Promise<NotebookMutationResult> {
	const handle = await loadServerNotebookHandle(folder, notebookId);
	if (!handle.isLuna) {
		return {
			diagnostics: [
				{
					path: 'notebookId',
					message: `"${notebookId}" is not a .luna notebook (it's a promoted/flat dbt model file) — apply_notebook_patch only supports .luna notebooks.`
				}
			]
		};
	}

	const hasContentPatch = !!(patch.blueprint || patch.document || patch.operations);
	if (!hasContentPatch && patch.title?.trim()) {
		const notebook = await renameLunaNotebook(folder, notebookId, patch.title.trim());
		return { diagnostics: [], notebook };
	}
	if (!hasContentPatch) {
		return {
			diagnostics: [
				{ path: 'patch', message: 'Provide one of: blueprint, document, operations, or title.' }
			]
		};
	}

	let document: PMDocJSON | null = null;
	let diagnostics: NotebookBlueprintDiagnostic[] = [];
	let executableCells: McpExecutableCellInput[] = patch.executableCells ?? [];

	if (patch.blueprint) {
		const compiled = compileNotebookBlueprint(
			patch.blueprint,
			handle.knownRefs,
			handle.knownCellIds
		);
		document = compiled.document;
		diagnostics = compiled.diagnostics;
		executableCells = [
			...executableCells,
			...(compiled.executableCells as McpExecutableCellInput[])
		];
	} else if (patch.document) {
		diagnostics = validateNotebookPmDocument(patch.document, handle.knownRefs);
		document = diagnostics.length ? null : patch.document;
	} else if (patch.operations) {
		const result = applyNotebookPatchOperations(handle.document, patch.operations);
		document = result.document;
		diagnostics = result.diagnostics;
	}

	if (!document) return { diagnostics };
	const placementDiagnostics = validateCellPlacements(document, executableCells, handle.cells);
	if (placementDiagnostics.length) return { diagnostics: placementDiagnostics };

	const tableDiagnostics = await checkExecutableCellTables(executableCells, handle.cells, tenant);
	if (tableDiagnostics.length) return { diagnostics: tableDiagnostics };

	let notebook = await commitDocumentToLunaFile(
		folder,
		notebookId,
		document,
		executableCells,
		handle.cells
	);
	if (patch.title?.trim()) {
		notebook = await renameLunaNotebook(folder, notebookId, patch.title.trim());
	}
	return { diagnostics: [], notebook };
}

export async function validateNotebookOnDisk(
	folder: string,
	notebookId: string
): Promise<NotebookBlueprintDiagnostic[]> {
	const handle = await loadServerNotebookHandle(folder, notebookId);
	return validateNotebookPmDocument(handle.document, handle.knownRefs);
}

export async function inspectNotebookOnDisk(
	folder: string,
	notebookId: string
): Promise<{ document: PMDocJSON; cells: Cell[] }> {
	const handle = await loadServerNotebookHandle(folder, notebookId);
	return { document: handle.document, cells: handle.cells };
}

export async function deleteNotebookOnDisk(
	folder: string,
	notebookId: string
): Promise<NotebookMutationResult> {
	const handle = await loadServerNotebookHandle(folder, notebookId);
	if (!handle.isLuna) {
		return {
			diagnostics: [{ path: 'notebookId', message: `"${notebookId}" is not a .luna notebook.` }]
		};
	}
	await fs.unlink(handle.filePath);
	return { diagnostics: [] };
}

export async function setCellChartConfig(
	folder: string,
	notebookId: string,
	cellRef: string,
	chartConfig: ChartConfig | null
): Promise<NotebookMutationResult> {
	const handle = await loadServerNotebookHandle(folder, notebookId);
	if (!handle.isLuna) {
		return {
			diagnostics: [{ path: 'notebookId', message: `"${notebookId}" is not a .luna notebook.` }]
		};
	}
	const cell = handle.cells.find((c) => c.id === cellRef || c.outputName === cellRef);
	if (!cell) {
		return { diagnostics: [{ path: 'cellRef', message: `Cell "${cellRef}" not found.` }] };
	}
	const nextCells = handle.cells.map((c) =>
		c === cell
			? {
					...c,
					resultChartConfig: chartConfig,
					resultViewMode: chartConfig ? 'chart' : c.resultViewMode
				}
			: c
	) as Cell[];
	const content = serializeLunaFile(nextCells.map(cellToSerializableCell));
	await writeProjectFile(folder, lunaRelPath(notebookId), content);
	const notebook = await getNotebookById(folder, notebookId);
	return { diagnostics: [], notebook };
}

/** Best-effort chart-type heuristic for `pick_chart` — mirrors the shape of
 *  the client's auto-chart picker (a numeric+categorical pair -> bar, a
 *  date/time column -> line, otherwise fall back to table) without pulling in
 *  its full implementation, which lives in browser-only chart-recommendation
 *  code. Good enough for a headless "give me something reasonable" default;
 *  callers who want precise control should use set_chart instead. */
export function pickChartHeuristic(
	rows: Record<string, unknown>[],
	columns: string[]
): ChartConfig | null {
	if (!rows.length || columns.length < 2) return null;
	const sample = rows[0];
	const isNumeric = (col: string) => typeof sample[col] === 'number';
	const isDateLike = (col: string) =>
		/date|time|_at$|_dt$/i.test(col) &&
		(typeof sample[col] === 'string' || sample[col] instanceof Date);
	const dateCol = columns.find(isDateLike);
	const numericCols = columns.filter(isNumeric);
	const categoricalCols = columns.filter((c) => !isNumeric(c) && !isDateLike(c));
	if (!numericCols.length) return null;
	if (dateCol) {
		return {
			chartType: 'line',
			xColumn: dateCol,
			yColumns: numericCols.slice(0, 3),
			colorColumn: null
		};
	}
	if (categoricalCols.length) {
		return {
			chartType: 'bar',
			xColumn: categoricalCols[0],
			yColumns: numericCols.slice(0, 1),
			colorColumn: null
		};
	}
	return null;
}

// ── Run loop ─────────────────────────────────────────────────────────────────

export interface CellRunResult {
	cellId: string;
	outputName: string;
	cellType: CellType;
	ok: boolean;
	error?: string;
	rows?: Record<string, unknown>[];
	columns?: string[];
	figures?: string[];
	runtimeSql?: string;
	rowCount?: number;
	resourceRef?: string;
	outputRef?: string;
}

function compilePrqlToSql(prql: string): string | null {
	try {
		const opts = new CompileOptions();
		opts.target = 'sql.trino';
		opts.signature_comment = false;
		const result = compilePrql(prql, opts);
		return result || null;
	} catch {
		return null;
	}
}

async function runQueryCellOnDisk(
	cells: Cell[],
	idx: number,
	tenant?: TenantRef | null
): Promise<{ rows: Record<string, unknown>[]; columns: string[]; sql: string }> {
	const cell = cells[idx];
	if (!cell.connectionId) {
		throw new Error(
			`Cell "${cell.outputName}" has no connection configured — set connectionId when creating/patching the cell.`
		);
	}
	const connection = await getConnectionMetadata(cell.connectionId, tenant?.orgId);
	if (!connection) throw new Error(`Unknown connection id "${cell.connectionId}".`);
	if (connection.type === 'duckdb-wasm') {
		throw new Error(
			'The built-in DuckDB connection runs in-browser only and cannot be run via MCP/API. ' +
				'Target an external connection (Postgres, ClickHouse, etc.) instead.'
		);
	}
	const sql = buildSQLExecutionCode(cells, idx, compilePrqlToSql);
	const secret = await getSecret(connection.id, tenant?.orgId);
	if (!tenant?.orgId) {
		assertCloudTenantRef(tenant ?? { orgId: '' }, 'Running a cell against an external connection');
		const result = await queryExternalConnection(connection, secret ?? undefined, sql);
		return { ...result, sql };
	}
	const availableConnections = await listConnectionsMetadata(tenant?.orgId, {
		includePhysicalCatalogName: true
	});
	const result = await queryExternalConnection(
		connection,
		secret ?? undefined,
		sql,
		undefined,
		tenant?.orgId,
		availableConnections
	);
	return { ...result, sql };
}

function waitForPythonJob(jobId: string, timeoutMs = 60_000): Promise<PythonRunResult> {
	return new Promise((resolve, reject) => {
		const job = getPythonJob(jobId);
		if (!job) {
			reject(new Error('Python job not found immediately after spawning it.'));
			return;
		}
		if (job.done) {
			resolve(
				job.result ?? { error: 'No result', missingModule: null, figures: [], dataframe: null }
			);
			return;
		}
		const timer = setTimeout(() => {
			job.emitter.off('done', onDone);
			reject(new Error('Python cell execution timed out.'));
		}, timeoutMs);
		const onDone = () => {
			clearTimeout(timer);
			resolve(
				job.result ?? { error: 'No result', missingModule: null, figures: [], dataframe: null }
			);
		};
		job.emitter.once('done', onDone);
	});
}

async function runPythonCellOnDisk(
	notebookId: string,
	cells: Cell[],
	idx: number,
	computed: Map<string, { rows: Record<string, unknown>[]; columns: string[] }>
): Promise<PythonRunResult> {
	const cell = cells[idx];
	const deps = resolvePythonDataRefs(cells, idx);
	const tables: Record<string, { rows: Record<string, unknown>[]; columns: string[] }> = {};
	const tableDescriptors = [];
	for (const dep of deps) {
		const result = computed.get(dep.outputName);
		if (!result) {
			throw new Error(
				`Upstream cell "${dep.outputName}" has not been run in this pass — include it earlier in cellIds.`
			);
		}
		tables[dep.outputName] = result;
		tableDescriptors.push({
			dataKey: dep.outputName,
			canonicalName: dep.outputName,
			source: 'cell' as const,
			aliases: [dep.outputName],
			columns: result.columns,
			rowMode: 'full' as const
		});
	}
	const jobId = spawnPythonCell(notebookId, cell.code, tables, tableDescriptors);
	return waitForPythonJob(jobId);
}

/**
 * Runs a plot cell's JS in a real `vm` context (not `new Function`, which the
 * browser/client path uses and which has full access to the host global object)
 * — a frozen sandbox exposing only the referenced cells' `{rows, columns}}` and
 * disabling runtime code generation (`eval`/`new Function` from inside the
 * sandboxed code itself). This is still not a hard security boundary (Node's vm
 * module is documented as not one), which is why this path is gated the same as
 * every other notebook-write action — a scoped, authenticated API key, not
 * arbitrary untrusted input. See docs/guide/10-automation-api.md.
 */
function runPlotCellInVm(
	cells: Cell[],
	idx: number,
	computed: Map<string, { rows: Record<string, unknown>[]; columns: string[] }>
): { data: unknown[]; layout: unknown } {
	const cell = cells[idx];
	const deps = resolvePlotDataRefs(cells, idx);
	const sandbox: Record<string, unknown> = {};
	for (const dep of deps) {
		sandbox[dep.outputName] = computed.get(dep.outputName) ?? { rows: [], columns: [] };
	}
	const context = vm.createContext(sandbox, {
		name: 'lunapad-plot-cell',
		codeGeneration: { strings: false, wasm: false }
	});
	const script = new vm.Script(`(function () {\n'use strict';\n${cell.code}\n})()`, {
		filename: 'plot-cell.js'
	});
	const result = script.runInContext(context, { timeout: 5000 });
	if (result === undefined) {
		throw new Error('code did not return anything — did you forget `return`?');
	}
	if (
		result === null ||
		typeof result !== 'object' ||
		!Array.isArray((result as { data?: unknown }).data)
	) {
		throw new Error('code must return a Plotly figure object: { data: [...], layout: {...} }');
	}
	const fig = result as { data: unknown[]; layout?: unknown };
	return { data: fig.data, layout: fig.layout ?? {} };
}

export interface RunNotebookCellsOptions {
	/** Gate for python-cell execution — callers must check admin:manage before
	 *  passing true (see permissions.ts's scope map for /api/mcp and /api/v1). */
	allowPython: boolean;
	tenant?: TenantRef | null;
}

export interface NotebookRunOutput {
	results: CellRunResult[];
	diagnostics: NotebookBlueprintDiagnostic[];
	execution: {
		selectedCellIds: string[];
		unresolvedCellIds: string[];
		validCellIds: string[];
	};
}

export async function runNotebookCellsOnDisk(
	folder: string,
	notebookId: string,
	cellIds: string[] | undefined,
	opts: RunNotebookCellsOptions
): Promise<NotebookRunOutput> {
	const handle = await loadServerNotebookHandle(folder, notebookId);
	const validCellIds = handle.cells
		.filter((c) => c.cellType === 'query' || c.cellType === 'python' || c.cellType === 'plot')
		.map((c) => c.id);
	const targets =
		cellIds && cellIds.length
			? handle.cells.filter((c) => cellIds.includes(c.id) || cellIds.includes(c.outputName))
			: handle.cells.filter(
					(c) => c.cellType === 'query' || c.cellType === 'python' || c.cellType === 'plot'
				);
	const matchedRefs = new Set(targets.flatMap((c) => [c.id, c.outputName]));
	const unresolvedCellIds = (cellIds ?? []).filter((id) => !matchedRefs.has(id));
	if (unresolvedCellIds.length) {
		return {
			results: [],
			diagnostics: [
				{
					path: 'cellIds',
					message: `Unknown cell id(s): ${unresolvedCellIds.join(', ')}. Valid cell ids: ${validCellIds.join(', ') || '(none)'}.`
				}
			],
			execution: {
				selectedCellIds: targets.map((c) => c.id),
				unresolvedCellIds,
				validCellIds
			}
		};
	}

	const results: CellRunResult[] = [];
	const computed = new Map<string, { rows: Record<string, unknown>[]; columns: string[] }>();

	for (const cell of targets) {
		const idx = handle.cells.indexOf(cell);
		try {
			if (cell.cellType === 'query') {
				const result = await runQueryCellOnDisk(handle.cells, idx, opts.tenant);
				computed.set(cell.outputName, result);
				results.push({
					cellId: cell.id,
					outputName: cell.outputName,
					cellType: 'query',
					ok: true,
					rows: result.rows,
					columns: result.columns,
					runtimeSql: result.sql,
					rowCount: result.rows.length,
					resourceRef: `cell:${notebookId}#${cell.id}`,
					outputRef: `output:${notebookId}#${cell.outputName}`
				});
			} else if (cell.cellType === 'python') {
				if (!opts.allowPython) {
					throw new Error(
						'Python cell execution requires admin-level API-key access (matches the existing /api/python/* policy).'
					);
				}
				const result = await runPythonCellOnDisk(notebookId, handle.cells, idx, computed);
				if (result.dataframe) computed.set(cell.outputName, result.dataframe);
				results.push({
					cellId: cell.id,
					outputName: cell.outputName,
					cellType: 'python',
					ok: !result.error,
					error: result.error ?? undefined,
					rows: result.dataframe?.rows,
					columns: result.dataframe?.columns,
					figures: result.figures,
					rowCount: result.dataframe?.rows.length,
					resourceRef: `cell:${notebookId}#${cell.id}`,
					outputRef: `output:${notebookId}#${cell.outputName}`
				});
			} else if (cell.cellType === 'plot') {
				const figure = runPlotCellInVm(handle.cells, idx, computed);
				results.push({
					cellId: cell.id,
					outputName: cell.outputName,
					cellType: 'plot',
					ok: true,
					rows: [],
					columns: [],
					figures: [JSON.stringify(figure)],
					rowCount: 0,
					resourceRef: `cell:${notebookId}#${cell.id}`,
					outputRef: `output:${notebookId}#${cell.outputName}`
				});
			}
		} catch (err) {
			results.push({
				cellId: cell.id,
				outputName: cell.outputName,
				cellType: cell.cellType,
				ok: false,
				error: (err as Error).message,
				resourceRef: `cell:${notebookId}#${cell.id}`,
				outputRef: cell.outputName ? `output:${notebookId}#${cell.outputName}` : undefined
			});
		}
	}
	return {
		results,
		diagnostics: [],
		execution: {
			selectedCellIds: targets.map((c) => c.id),
			unresolvedCellIds: [],
			validCellIds
		}
	};
}

// ── chat-tool-policy.ts context builder ─────────────────────────────────────

/** Builds a ChatToolPolicyContext from a loaded notebook handle so MCP/REST
 *  mutation handlers can reuse the SAME guardrails (unknown-table refs,
 *  bulk-delete heuristics, Markdoc critical-failure gating) the AI chat's SSE
 *  route already enforces, instead of re-implementing them. MCP has no chat
 *  turn, so `latestUserMessage` is empty — the bulk-delete phrase scan simply
 *  finds nothing, which is the correct conservative default, not a gap. */
export function buildMcpToolPolicyContext(handle: ServerNotebookHandle): ChatToolPolicyContext {
	const cellOutputNames = new Set(handle.cells.map((c) => c.outputName).filter(Boolean));
	const chartedOutputNames = new Set(
		handle.cells.filter((c) => c.resultChartConfig?.xColumn).map((c) => c.outputName)
	);
	return {
		schemaTableNames: cellOutputNames,
		cellOutputNames,
		chartedOutputNames,
		latestUserMessage: ''
	};
}
