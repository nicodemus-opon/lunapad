import { compile, CompileOptions } from 'prqlc/dist/node/prqlc_js';
import type { Connection } from '$lib/types/connection';
import type { Notebook, NotebookFolder } from '$lib/stores/notebook.svelte';
import { listConnectionsMetadata, getConnectionMetadata } from './connections-store.js';
import { getSecret } from './connection-secrets.js';
import { queryExternalConnection } from './connections.js';
import { assertAllowedProjectFolder, walkProjectDirectory } from './project.js';
import { getCurrentFolder } from './dbt-schedules.js';
import { spawnDbt, getJob } from './dbt-runner.js';
import { precompileProjectModels, collectProjectModelNames } from './prql-compiler.js';
import { loadManifest, type DbtModel } from './dbt.js';
import { loadWorkspaceState, saveWorkspaceState } from './workspace-store.js';

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
	assertAllowedProjectFolder(resolved);
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

// ── Workspace mutations (headless agent / server executor) ───────────────────

interface WorkspaceCell {
	id: string;
	outputName?: string;
	code?: string;
	markdown?: string;
}

interface WorkspaceBlob {
	notebooks?: Array<{
		id: string;
		cells?: WorkspaceCell[];
	}>;
	activeTabId?: string;
}

function findCellInWorkspace(
	data: WorkspaceBlob,
	cellRef: string
): { notebookId: string; cell: WorkspaceCell } | null {
	for (const nb of data.notebooks ?? []) {
		for (const cell of nb.cells ?? []) {
			if (cell.id === cellRef || cell.outputName === cellRef) {
				return { notebookId: nb.id, cell };
			}
		}
	}
	return null;
}

export interface UpdateWorkspaceCellInput {
	cellRef: string;
	code?: string;
	markdown?: string;
	userId?: string | null;
	expectedUpdatedAt?: string | null;
}

export async function updateWorkspaceCellAction(
	input: UpdateWorkspaceCellInput
): Promise<{ ok: true; cellId: string; updatedAt: string }> {
	const row = await loadWorkspaceState();
	if (!row?.data) throw new Error('No workspace state on server.');
	const data = row.data as WorkspaceBlob;
	const found = findCellInWorkspace(data, input.cellRef);
	if (!found) throw new Error(`Cell "${input.cellRef}" not found in workspace.`);
	if (input.code !== undefined) found.cell.code = input.code;
	if (input.markdown !== undefined) found.cell.markdown = input.markdown;
	const saved = await saveWorkspaceState(data, input.userId ?? null, {
		expectedUpdatedAt: input.expectedUpdatedAt ?? row.updatedAt
	});
	return { ok: true, cellId: found.cell.id, updatedAt: saved.updatedAt };
}

export interface CreateWorkspaceCellInput {
	notebookId?: string;
	outputName: string;
	code?: string;
	markdown?: string;
	userId?: string | null;
	expectedUpdatedAt?: string | null;
}

export async function createWorkspaceCellAction(
	input: CreateWorkspaceCellInput
): Promise<{ ok: true; cellId: string; updatedAt: string }> {
	const row = await loadWorkspaceState();
	if (!row?.data) throw new Error('No workspace state on server.');
	const data = row.data as WorkspaceBlob;
	const nbId = input.notebookId ?? data.activeTabId;
	const nb = data.notebooks?.find((n) => n.id === nbId);
	if (!nb) throw new Error(`Notebook "${nbId}" not found.`);
	const cellId = `cell_${Date.now()}`;
	const cell = {
		id: cellId,
		outputName: input.outputName,
		code: input.code ?? '',
		markdown: input.markdown,
		language: 'sql' as const,
		cellType: input.markdown ? ('markdown' as const) : ('query' as const)
	};
	nb.cells = [...(nb.cells ?? []), cell];
	const saved = await saveWorkspaceState(data, input.userId ?? null, {
		expectedUpdatedAt: input.expectedUpdatedAt ?? row.updatedAt
	});
	return { ok: true, cellId, updatedAt: saved.updatedAt };
}

// ── Shares / publishing ──────────────────────────────────────────────────────

export async function listSharesAction(): Promise<{
	shares: Array<{
		notebookId: string;
		notebookName: string;
		token: string;
		slug: string | null;
	}>;
}> {
	const { listActiveShares } = await import('./shared-reports.js');
	const shares = await listActiveShares();
	return {
		shares: shares.map((s) => ({
			notebookId: s.notebookId,
			notebookName: s.notebookName,
			token: s.token,
			slug: s.slug
		}))
	};
}

export interface PublishNotebookInput {
	notebookId: string;
}

export async function publishNotebookAction(
	input: PublishNotebookInput
): Promise<{ token: string; slug: string | null }> {
	const { loadWorkspaceState } = await import('./workspace-store.js');
	const { getShareByNotebookId, upsertShare } = await import('./shared-reports.js');
	const { buildShareSnapshot } = await import('$lib/services/share-snapshot');
	const { getSecret } = await import('./connection-secrets.js');

	const row = await loadWorkspaceState();
	if (!row?.data) throw new Error('No workspace state on server.');
	const blob = row.data as WorkspaceBlob & { connections?: Connection[] };
	const notebook = blob.notebooks?.find((n) => n.id === input.notebookId) as Notebook | undefined;
	if (!notebook) throw new Error(`Notebook "${input.notebookId}" not found in workspace.`);

	const snapshot = buildShareSnapshot(notebook, blob.connections ?? []);
	const existing = await getShareByNotebookId(input.notebookId);
	const connInputs = await Promise.all(
		snapshot.connections.map(async (conn) => ({
			connectionId: conn.connectionId,
			connection: conn.connection,
			secret: await getSecret(conn.connectionId)
		}))
	);
	const share = await upsertShare({
		notebookId: notebook.id,
		notebookName: notebook.name,
		snapshot: { cells: snapshot.cells, reportView: snapshot.reportView },
		pollIntervalMs: existing?.pollIntervalMs ?? null,
		requireAuth: existing?.requireAuth,
		slug: existing?.slug ?? null,
		connections: connInputs
	});
	return { token: share.token, slug: share.slug };
}

export interface CreateSitePageInput {
	siteId: string;
	pageSlug: string;
	navLabel: string;
	shareToken: string;
}

export async function createSitePageAction(
	input: CreateSitePageInput
): Promise<{ pageId: number }> {
	const { addPageToSite } = await import('./sites.js');
	const { getShareByToken } = await import('./shared-reports.js');
	const share = await getShareByToken(input.shareToken);
	const page = await addPageToSite({
		siteId: input.siteId,
		pageSlug: input.pageSlug,
		navLabel: input.navLabel,
		shareToken: input.shareToken,
		notebookId: share?.notebookId ?? null
	});
	return { pageId: page.id };
}
