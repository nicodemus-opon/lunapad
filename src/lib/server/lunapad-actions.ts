import { compile, CompileOptions } from 'prqlc/dist/node/prqlc_js';
import type { Connection } from '$lib/types/connection';
import type { Notebook, NotebookFolder } from '$lib/stores/notebook.svelte';
import { listConnectionsMetadata, getConnectionMetadata } from './connections-store.js';
import { getSecret } from './connection-secrets.js';
import { queryExternalConnection } from './connections.js';
import { walkProjectDirectory } from './project.js';
import { getCurrentFolder } from './dbt-schedules.js';
import { spawnDbt, getJob } from './dbt-runner.js';
import { precompileProjectModels, collectProjectModelNames } from './prql-compiler.js';
import { loadManifest, type DbtModel } from './dbt.js';

/**
 * Plain async functions with no SvelteKit-specific types — the single source of truth
 * called identically by both the /api/v1/* REST routes and the MCP tool handlers, so
 * neither surface duplicates business logic.
 */

// ── Connections ────────────────────────────────────────────────────────────────

export async function listConnectionsAction(): Promise<{ connections: Connection[] }> {
	return { connections: await listConnectionsMetadata() };
}

async function resolveConnectionForQuery(connectionId: string): Promise<Connection> {
	const connection = await getConnectionMetadata(connectionId);
	if (!connection) {
		throw new Error(
			`Unknown connection id "${connectionId}". Use list_connections to see available connections.`
		);
	}
	if (connection.type === 'duckdb-wasm') {
		throw new Error(
			'The built-in DuckDB connection runs in-browser only and cannot be queried via the API/MCP server. ' +
				'Target an external connection (Postgres, ClickHouse, etc.) instead.'
		);
	}
	return connection;
}

export interface RunQueryInput {
	connectionId: string;
	sql: string;
}

export interface RunQueryResult {
	rows: Record<string, unknown>[];
	columns: string[];
}

export async function runQueryAction(input: RunQueryInput): Promise<RunQueryResult> {
	const connection = await resolveConnectionForQuery(input.connectionId);
	const secret = await getSecret(connection.id);
	return queryExternalConnection(connection, secret ?? undefined, input.sql);
}

export interface RunPrqlInput {
	connectionId: string;
	prql: string;
}

export async function runPrqlAction(input: RunPrqlInput): Promise<RunQueryResult> {
	const connection = await resolveConnectionForQuery(input.connectionId);

	let sql: string;
	try {
		const opts = new CompileOptions();
		opts.target = 'sql.trino';
		opts.signature_comment = false;
		const result = compile(input.prql, opts);
		if (!result) throw new Error('PRQL compile returned empty output.');
		sql = result;
	} catch (err) {
		throw new Error(`PRQL compile error: ${(err as Error).message}`);
	}

	const secret = await getSecret(connection.id);
	return queryExternalConnection(connection, secret ?? undefined, sql);
}

// ── Notebooks (project-folder mode only — see note below) ──────────────────────

/**
 * Notebooks are client-localStorage-only unless a dbt project folder is open, in which
 * case they're reconstructed from disk via walkProjectDirectory. These actions can only
 * see project-folder-backed notebooks — ad hoc browser-tab notebooks are not reachable
 * headlessly. Callers must pass `folder` explicitly, or have one already open via
 * setCurrentFolder (e.g. the PROJECT_FOLDER env var, or the last-opened project in this
 * running instance).
 */
function resolveFolder(folder: string | undefined): string {
	const resolved = folder ?? getCurrentFolder();
	if (!resolved) {
		throw new Error(
			'No project folder specified and none is currently open. Pass `folder` explicitly.'
		);
	}
	return resolved;
}

export interface ListNotebooksInput {
	folder?: string;
}

export interface ListNotebooksResult {
	notebooks: Array<{ id: string; name: string; folderId: string | null; cellCount: number }>;
	folders: NotebookFolder[];
}

export async function listNotebooksAction(input: ListNotebooksInput): Promise<ListNotebooksResult> {
	const folder = resolveFolder(input.folder);
	const { notebooks, folders } = await walkProjectDirectory(folder);
	return {
		notebooks: notebooks.map((n) => ({
			id: n.id,
			name: n.name,
			folderId: n.folderId,
			cellCount: n.cells.length
		})),
		folders
	};
}

export interface GetNotebookInput {
	folder?: string;
	notebookId: string;
}

export async function getNotebookAction(input: GetNotebookInput): Promise<{ notebook: Notebook }> {
	const folder = resolveFolder(input.folder);
	const { notebooks } = await walkProjectDirectory(folder);
	const notebook = notebooks.find((n) => n.id === input.notebookId);
	if (!notebook) throw new Error(`Notebook "${input.notebookId}" not found.`);
	return { notebook };
}

// ── dbt ──────────────────────────────────────────────────────────────────────

export interface DbtRunInput {
	folder?: string;
	select?: string;
}

export interface DbtJobResult {
	jobId: string;
}

async function precompileAndSpawn(folder: string, args: string[]): Promise<DbtJobResult> {
	const knownModels = await collectProjectModelNames(folder);
	await precompileProjectModels(folder, knownModels);
	return { jobId: spawnDbt(args, folder) };
}

export async function dbtRunAction(input: DbtRunInput): Promise<DbtJobResult> {
	const folder = resolveFolder(input.folder);
	const args = ['run'];
	if (input.select) args.push('--select', input.select);
	return precompileAndSpawn(folder, args);
}

export async function dbtCompileAction(input: DbtRunInput): Promise<DbtJobResult> {
	const folder = resolveFolder(input.folder);
	return precompileAndSpawn(folder, ['compile']);
}

export interface DbtJobStatusInput {
	jobId: string;
}

export interface DbtJobStatusResult {
	done: boolean;
	exitCode: number | null;
	lines: string[];
}

export async function getDbtJobStatusAction(input: DbtJobStatusInput): Promise<DbtJobStatusResult> {
	const job = getJob(input.jobId);
	if (!job) throw new Error(`Unknown or expired job id "${input.jobId}".`);
	return { done: job.done, exitCode: job.exitCode, lines: job.lines };
}

export interface DbtManifestInput {
	folder?: string;
}

export async function getDbtManifestAction(
	input: DbtManifestInput
): Promise<{ models: DbtModel[] }> {
	const folder = resolveFolder(input.folder);
	return { models: await loadManifest(folder) };
}
