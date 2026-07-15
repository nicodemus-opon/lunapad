import { z } from 'zod';

/**
 * Zod param shapes for the notebook-authoring MCP tools — deliberately mirrors
 * the field names/semantics of the OpenAI-format schemas in
 * ../server/tools/native-schemas.ts (create_notebook, apply_notebook_patch, etc.)
 * rather than deriving from them: that file describes tool params as plain JSON
 * Schema objects (the format the chat completion APIs expect), while
 * `McpServer.registerTool` wants zod raw shapes — the two type systems don't
 * convert cleanly without a bigger schema-format unification than this project
 * takes on. Kept intentionally permissive for the deeply-nested `blocks`/
 * `document`/`operations` fields (z.record/z.any) — same as native-schemas.ts,
 * which only requires `{ type: string }` per block rather than exhaustively
 * typing all 23 block variants — because the REAL validation already happens
 * inside compileNotebookBlueprint/applyNotebookPatchOperations/
 * validateNotebookPmDocument, which return repairable diagnostics instead of a
 * schema rejection.
 */

const executableCellShape = z.object({
	cellId: z
		.string()
		.describe(
			'Stable cell id preserved exactly as authored and used by queryBlock nodes, e.g. q_monthly_revenue.'
		),
	outputName: z
		.string()
		.describe(
			'Composable SQL/Python output name, e.g. monthly_revenue. Must be unique unless a patch operation explicitly resolves conflicts.'
		),
	cellType: z.enum(['query', 'python', 'plot']).optional(),
	language: z.enum(['sql', 'prql']).optional(),
	code: z.string(),
	connectionId: z
		.string()
		.nullable()
		.optional()
		.describe(
			'Required for query cells you want to run via run_query_nodes/run_cells — MCP has no ' +
				'browser app-state to infer a default connection from. Use list_connections to find one. ' +
				'The built-in DuckDB connection cannot be targeted (browser-only).'
		),
	materializeMode: z.enum(['ephemeral', 'view', 'table', 'incremental']).optional()
});

const blockShape = z
	.record(z.string(), z.unknown())
	.describe(
		'A notebook presentation block: {"type":"queryBlock","cellId":"..."} to place an executable ' +
			'cell, or a visual report block for infographic/poster/website-like analytical pages ' +
			'({"type":"text"|"divider"|"grid"|"columns"|"card"|"metric"|"chart"|"datatable"|' +
			'"badge"|"progress"|"callout"|"details"|"tabs"|"filter"|"mermaid"|"each"|"group"|' +
			'"conditional"|"toc"|"math"|"video"|"embed"|"bookmark"|...}). Use columns for ' +
			'asymmetric report layouts, grid for compact tiles, metric size="hero" for big numerals, ' +
			'metric iconCount/iconTotal for pictogram rows, chart blocks for line/bar/pie/map/choropleth, ' +
			'and datatable conditionalFormats for dense comparison tables. Container blocks nest child ' +
			'blocks recursively via their own `blocks`/`items`/`columns` field. Call get_visual_report_grammar ' +
			'for full block types, data roles, composition patterns, style axes, icon names, and generic blueprint seeds.'
	);

export const createNotebookShape = {
	notebookId: z
		.string()
		.describe(
			'Relative path (no extension) for the new .luna notebook, e.g. "models/reporting/monthly_summary". ' +
				'Fails if a notebook already exists at this id — use apply_notebook_patch to edit an existing one.'
		),
	folder: z.string().optional().describe('Project folder. Omit to use the currently open project.'),
	title: z.string().optional(),
	executableCells: z.array(executableCellShape).optional(),
	blocks: z
		.array(blockShape)
		.describe(
			'Typed report/page blueprint blocks. Can compose plain notebooks, dense infographic reports, civic posters, forecast reports, and website-like reports.'
		)
};

export const applyNotebookPatchShape = {
	notebookId: z.string().describe('Id of the existing .luna notebook to patch.'),
	folder: z.string().optional(),
	title: z.string().optional().describe('Rename the notebook (renames its underlying .luna file).'),
	blueprint: z
		.object({
			title: z.string().optional(),
			executableCells: z.array(executableCellShape).optional(),
			blocks: z.array(blockShape)
		})
		.optional()
		.describe(
			'Whole-document replacement via the typed blueprint grammar (same shape as create_notebook).'
		),
	document: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('Raw ProseMirror document replacement.'),
	operations: z
		.array(z.record(z.string(), z.unknown()))
		.optional()
		.describe(
			'Node-level surgical ops: {"op":"insert_node"|"replace_node"|"delete_node"|"patch_attrs"|"move_node"|"replace_document", "nodeId":"...", ...}. ' +
				'Use inspect_notebook first to get real nodeIds.'
		),
	executableCells: z.array(executableCellShape).optional()
};

export const inspectNotebookShape = {
	notebookId: z.string(),
	folder: z.string().optional()
};

export const validateNotebookShape = {
	notebookId: z.string(),
	folder: z.string().optional()
};

export const runNotebookCellsShape = {
	notebookId: z.string(),
	folder: z.string().optional(),
	cellIds: z
		.array(z.string())
		.optional()
		.describe(
			'Cell ids or outputNames to run. Omit to run every query/python/plot cell in the notebook.'
		)
};

export const pickChartShape = {
	notebookId: z.string(),
	folder: z.string().optional(),
	cellId: z.string().describe('The already-run cell (id or outputName) to auto-chart.')
};

export const setChartShape = {
	notebookId: z.string(),
	folder: z.string().optional(),
	cellId: z.string(),
	chartConfig: z
		.object({
			chartType: z.string(),
			xColumn: z.string(),
			yColumns: z.array(z.string()),
			colorColumn: z.string().nullable().optional(),
			sizeColumn: z.string().nullable().optional(),
			seriesMode: z.string().optional(),
			sortOrder: z.string().optional(),
			title: z.string().optional(),
			latColumn: z.string().optional(),
			lonColumn: z.string().optional(),
			geoScope: z.string().optional(),
			code: z.string().optional()
		})
		.nullable()
		.describe('Pass null to clear the chart back to table view.')
};
