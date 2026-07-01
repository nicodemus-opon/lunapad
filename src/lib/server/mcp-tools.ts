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
	createSitePageAction
} from './lunapad-actions.js';

function ok(result: unknown): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

function fail(err: unknown): CallToolResult {
	return {
		content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
		isError: true
	};
}

/**
 * Builds a fresh MCP server with Lunapad's curated tool set, mapped 1:1 to the
 * /api/v1 actions in lunapad-actions.ts — same source of truth, no duplicated logic.
 * Called fresh per request (stateless transport, see routes/api/mcp/+server.ts) so
 * there's no shared mutable state to worry about across concurrent requests.
 */
export function createLunapadMcpServer(): McpServer {
	const server = new McpServer({ name: 'lunapad', version: '1.0.0' });

	server.registerTool(
		'list_connections',
		{
			description:
				'List configured external connections (Postgres, ClickHouse, etc). Never returns secrets.'
		},
		async () => {
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
			try {
				return ok(await getNotebookAction({ folder, notebookId }));
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
			try {
				return ok(await createSitePageAction({ siteId, pageSlug, navLabel, shareToken }));
			} catch (err) {
				return fail(err);
			}
		}
	);

	return server;
}
