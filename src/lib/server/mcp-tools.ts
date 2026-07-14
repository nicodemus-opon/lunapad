import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
	listConnectionsAction,
	runQueryAction,
	runPrqlAction,
	listNotebooksAction,
	getNotebookAction,
	dbtRunAction,
	dbtCompileAction,
	getDbtJobStatusAction,
	getDbtManifestAction,
	listSharesAction,
	publishNotebookAction,
	createSitePageAction,
	createNotebookAction,
	patchNotebookAction,
	validateNotebookAction,
	inspectNotebookAction,
	runNotebookCellsAction,
	setChartAction,
	pickChartAction
} from './lunapad-actions.js';
import { can, hasApiScope, MCP_TOOL_ACTIONS, type PermissionUser } from './permissions.js';
import {
	createNotebookShape,
	applyNotebookPatchShape,
	inspectNotebookShape,
	validateNotebookShape,
	runNotebookCellsShape,
	pickChartShape,
	setChartShape
} from '$lib/agent/tools/notebook-tool-schemas.js';

export interface McpAuthContext {
	user: PermissionUser | null;
	apiKeyId: string | null;
	apiKeyScopes: string[] | null;
}

function ok(result: unknown): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function fail(err: unknown): CallToolResult {
	return {
		content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
		isError: true
	};
}

function forbidden(toolName: string, action: string): CallToolResult {
	return fail(
		new Error(
			`Forbidden: this API key/role cannot use tool "${toolName}" (requires "${action}"). ` +
				'Ask an admin to mint a key with the right scope, or use one of your own role\'s allowed tools.'
		)
	);
}

/**
 * Builds a fresh MCP server with Lunapad's curated tool set, mapped 1:1 to the
 * /api/v1 actions in lunapad-actions.ts — same source of truth, no duplicated logic.
 * Called fresh per request (stateless transport, see routes/api/mcp/+server.ts) so
 * there's no shared mutable state to worry about across concurrent requests.
 *
 * `auth` is required — hooks.server.ts intentionally skips its normal per-path
 * permission gate for /api/mcp (it can't see which tool a JSON-RPC body calls
 * before dispatch), so every tool handler here re-derives its own permission
 * requirement from MCP_TOOL_ACTIONS and checks it explicitly as the first thing
 * it does, before touching any action.
 */
export function createLunapadMcpServer(auth: McpAuthContext): McpServer {
	const server = new McpServer({ name: 'lunapad', version: '1.0.0' });

	function guard(toolName: string): CallToolResult | null {
		const action = MCP_TOOL_ACTIONS[toolName];
		if (!action) return null;
		// Scope restriction only applies to actual API-key callers (apiKeyId set) — a
		// session-cookie-authenticated caller (e.g. an admin hitting /api/mcp from their
		// own browser session) always has apiKeyScopes === null too and must be gated by
		// role alone, same as hooks.server.ts's main permission gate.
		if (!can(auth.user, action)) return forbidden(toolName, action);
		if (auth.apiKeyId && !hasApiScope(auth.apiKeyScopes, action)) return forbidden(toolName, action);
		return null;
	}

	server.registerTool(
		'list_connections',
		{
			description:
				'List configured external connections (Postgres, ClickHouse, etc). Never returns secrets.'
		},
		async () => {
			const denied = guard('list_connections');
			if (denied) return denied;
			try {
				return ok(await listConnectionsAction());
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'run_query',
		{
			description:
				'Run a read-only SQL query against an external connection by id. DuckDB-WASM (the built-in connection) ' +
				'is not supported — it only runs in-browser. Use list_connections to find a connectionId.',
			inputSchema: { connectionId: z.string(), sql: z.string() }
		},
		async ({ connectionId, sql }) => {
			const denied = guard('run_query');
			if (denied) return denied;
			try {
				return ok(await runQueryAction({ connectionId, sql }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'run_prql',
		{
			description: 'Compile PRQL to SQL and run it against an external connection by id.',
			inputSchema: { connectionId: z.string(), prql: z.string() }
		},
		async ({ connectionId, prql }) => {
			const denied = guard('run_prql');
			if (denied) return denied;
			try {
				return ok(await runPrqlAction({ connectionId, prql }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'list_notebooks',
		{
			description:
				'List notebooks in the currently open dbt project (or a specified project folder). ' +
				'Only project-folder-backed notebooks are visible here — notebooks that exist only in a ' +
				"browser tab's local storage cannot be listed by this tool.",
			inputSchema: { folder: z.string().optional() }
		},
		async ({ folder }) => {
			const denied = guard('list_notebooks');
			if (denied) return denied;
			try {
				return ok(await listNotebooksAction({ folder }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'get_notebook',
		{
			description:
				'Get a single notebook (with its cells) by id from the project-folder-backed notebook tree.',
			inputSchema: { folder: z.string().optional(), notebookId: z.string() }
		},
		async ({ folder, notebookId }) => {
			const denied = guard('get_notebook');
			if (denied) return denied;
			try {
				return ok(await getNotebookAction({ folder, notebookId }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'inspect_notebook',
		{
			description:
				'Inspect a notebook as its ProseMirror document plus cell list — use before patching an ' +
				'existing notebook to see current nodeIds/cellIds for apply_notebook_patch operations.',
			inputSchema: inspectNotebookShape
		},
		async ({ folder, notebookId }) => {
			const denied = guard('inspect_notebook');
			if (denied) return denied;
			try {
				return ok(await inspectNotebookAction({ folder, notebookId }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'create_notebook',
		{
			description:
				'Create a complete .luna notebook atomically from a typed blueprint (title + executable ' +
				'SQL/PRQL/Python/Plot cells + a nested presentation block tree — grids, charts, metrics, ' +
				'callouts, tabs, filters, pivot tables, mermaid diagrams, and more). Compiled and validated ' +
				'server-side before anything is written to disk — a failed compile returns repairable ' +
				'diagnostics instead of a partially-written file. Query cells need a connectionId (external ' +
				'connections only — list_connections first) to be runnable via run_query_nodes afterward.',
			inputSchema: createNotebookShape
		},
		async ({ folder, notebookId, title, executableCells, blocks }) => {
			const denied = guard('create_notebook');
			if (denied) return denied;
			try {
				return ok(
					await createNotebookAction({
						folder,
						notebookId,
						title,
						executableCells,
						blocks: blocks as never
					})
				);
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'apply_notebook_patch',
		{
			description:
				'Atomically patch an EXISTING .luna notebook. Provide exactly one of: `blueprint` (whole-' +
				'document replacement via the typed block grammar), `document` (raw PM document replacement), ' +
				'or `operations` (surgical node-level edits by nodeId — call inspect_notebook first to get ' +
				'real nodeIds). Include `executableCells` when introducing new queryBlock cells. `title` alone ' +
				'renames the notebook (renames its .luna file). Re-validated before commit.',
			inputSchema: applyNotebookPatchShape
		},
		async ({ folder, notebookId, title, blueprint, document, operations, executableCells }) => {
			const denied = guard('apply_notebook_patch');
			if (denied) return denied;
			try {
				return ok(
					await patchNotebookAction({
						folder,
						notebookId,
						title,
						blueprint: blueprint as never,
						document: document as never,
						operations: operations as never,
						executableCells
					})
				);
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'validate_notebook',
		{
			description:
				'Validate a notebook\'s current on-disk document: schema, container-nesting rules, and $ref ' +
				'resolution against live cell outputs. Call after create_notebook/apply_notebook_patch to ' +
				'confirm ok:true before considering the notebook finished.',
			inputSchema: validateNotebookShape
		},
		async ({ folder, notebookId }) => {
			const denied = guard('validate_notebook');
			if (denied) return denied;
			try {
				return ok(await validateNotebookAction({ folder, notebookId }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	async function runCellsHandler(args: {
		folder?: string;
		notebookId: string;
		cellIds?: string[];
	}): Promise<CallToolResult> {
		try {
			const canRunPython =
				can(auth.user, 'admin:manage') &&
				(!auth.apiKeyId || hasApiScope(auth.apiKeyScopes, 'admin:manage'));
			return ok(
				await runNotebookCellsAction({
					folder: args.folder,
					notebookId: args.notebookId,
					cellIds: args.cellIds,
					allowPython: canRunPython
				})
			);
		} catch (err) {
			return fail(err);
		}
	}

	server.registerTool(
		'run_query_nodes',
		{
			description:
				'Execute query/python/plot cells by cellId/outputName (omit cellIds to run every executable ' +
				'cell in the notebook). Query cells run against their configured external connection ' +
				'(DuckDB-WASM is not reachable headlessly). Python cells require an admin-scoped API key — ' +
				'same policy as the interactive /api/python endpoints. Returns rows/columns/errors per cell.',
			inputSchema: runNotebookCellsShape
		},
		async (args) => {
			const denied = guard('run_query_nodes');
			if (denied) return denied;
			return runCellsHandler(args);
		}
	);

	server.registerTool(
		'run_cells',
		{
			description: 'Alias of run_query_nodes — execute cells by id, or omit cellIds to run all.',
			inputSchema: runNotebookCellsShape
		},
		async (args) => {
			const denied = guard('run_cells');
			if (denied) return denied;
			return runCellsHandler(args);
		}
	);

	server.registerTool(
		'pick_chart',
		{
			description:
				'Run a cell then auto-pick a reasonable chart type from its result shape (numeric+categorical ' +
				'-> bar, a date column -> line, otherwise leaves it as a table). Best-effort heuristic — use ' +
				'set_chart for precise control over chart type/columns.',
			inputSchema: pickChartShape
		},
		async ({ folder, notebookId, cellId }) => {
			const denied = guard('pick_chart');
			if (denied) return denied;
			try {
				return ok(await pickChartAction({ folder, notebookId, cellId }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'set_chart',
		{
			description:
				'Explicitly set a cell\'s chart config (chartType/xColumn/yColumns/...). Pass chartConfig: null ' +
				'to clear back to table view.',
			inputSchema: setChartShape
		},
		async ({ folder, notebookId, cellId, chartConfig }) => {
			const denied = guard('set_chart');
			if (denied) return denied;
			try {
				return ok(
					await setChartAction({ folder, notebookId, cellId, chartConfig: chartConfig as never })
				);
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'dbt_run',
		{
			description:
				'Compile PRQL models and run `dbt run` (optionally scoped with --select) in a project folder.',
			inputSchema: { folder: z.string().optional(), select: z.string().optional() }
		},
		async ({ folder, select }) => {
			const denied = guard('dbt_run');
			if (denied) return denied;
			try {
				return ok(await dbtRunAction({ folder, select }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'dbt_compile',
		{
			description: 'Compile PRQL models and run `dbt compile` in a project folder.',
			inputSchema: { folder: z.string().optional() }
		},
		async ({ folder }) => {
			const denied = guard('dbt_compile');
			if (denied) return denied;
			try {
				return ok(await dbtCompileAction({ folder }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'get_dbt_job_status',
		{
			description:
				'Poll the status (done/exitCode/log lines) of a dbt job started by dbt_run or dbt_compile.',
			inputSchema: { jobId: z.string() }
		},
		async ({ jobId }) => {
			const denied = guard('get_dbt_job_status');
			if (denied) return denied;
			try {
				return ok(await getDbtJobStatusAction({ jobId }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'get_dbt_manifest',
		{
			description: 'Get the compiled dbt manifest (models, columns, lineage) for a project folder.',
			inputSchema: { folder: z.string().optional() }
		},
		async ({ folder }) => {
			const denied = guard('get_dbt_manifest');
			if (denied) return denied;
			try {
				return ok(await getDbtManifestAction({ folder }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'list_shares',
		{ description: 'List all active published report shares.' },
		async () => {
			const denied = guard('list_shares');
			if (denied) return denied;
			try {
				return ok(await listSharesAction());
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'publish_notebook',
		{
			description:
				'Publish a workspace notebook as a read-only share link (snapshot from server workspace state).',
			inputSchema: { notebookId: z.string() }
		},
		async ({ notebookId }) => {
			const denied = guard('publish_notebook');
			if (denied) return denied;
			try {
				return ok(await publishNotebookAction({ notebookId }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.registerTool(
		'create_site_page',
		{
			description: 'Add a published share as a page on a multi-page site.',
			inputSchema: {
				siteId: z.string(),
				pageSlug: z.string(),
				navLabel: z.string(),
				shareToken: z.string()
			}
		},
		async ({ siteId, pageSlug, navLabel, shareToken }) => {
			const denied = guard('create_site_page');
			if (denied) return denied;
			try {
				return ok(await createSitePageAction({ siteId, pageSlug, navLabel, shareToken }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	return server;
}
