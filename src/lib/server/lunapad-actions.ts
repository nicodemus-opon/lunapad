import { compile, CompileOptions } from 'prqlc/dist/node/prqlc_js';
import type { Connection } from '$lib/types/connection';
import type { Notebook, NotebookFolder } from '$lib/stores/notebook.svelte';
import { listConnectionsMetadata, getConnectionMetadata } from './connections-store.js';
import { getSecret } from './connection-secrets.js';
import { queryExternalConnection } from './connections.js';
import path from 'node:path';
import { assertAllowedProjectFolder, walkProjectDirectory } from './project.js';
import { getCurrentFolder } from './dbt-schedules.js';
import { spawnDbt, getJob } from './dbt-runner.js';
import { precompileProjectModels, collectProjectModelNames } from './prql-compiler.js';
import { loadManifest, type DbtModel } from './dbt.js';
import { loadWorkspaceState } from './workspace-store.js';
import type { ChartConfig } from '$lib/types/gui-pipeline.js';
import type {
	NotebookBlueprint,
	NotebookBlueprintDiagnostic
} from '$lib/services/notebook-blueprint.js';
import {
	createNotebookFromBlueprintOnDisk,
	patchNotebookOnDisk,
	validateNotebookOnDisk,
	inspectNotebookOnDisk,
	runNotebookCellsOnDisk,
	deleteNotebookOnDisk,
	setCellChartConfig,
	pickChartHeuristic,
	type McpExecutableCellInput,
	type NotebookPatchInput,
	type NotebookRunOutput
} from './notebook-mutation.js';
import {
	assertCloudTenantRef,
	deploymentMode,
	projectFolderFor,
	type TenantRef
} from './tenancy.js';

/**
 * Plain async functions with no SvelteKit-specific types — the single source of truth
 * called identically by both the /api/v1/* REST routes and the MCP tool handlers, so
 * neither surface duplicates business logic.
 */

// ── Connections ────────────────────────────────────────────────────────────────

export async function listConnectionsAction(
	tenant?: TenantRef | null
): Promise<{ connections: Connection[] }> {
	return { connections: await listConnectionsMetadata(tenant?.orgId) };
}

async function resolveConnectionForQuery(
	connectionId: string,
	tenant?: TenantRef | null
): Promise<Connection> {
	const connection = await getConnectionMetadata(connectionId, tenant?.orgId);
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
	tenant?: TenantRef | null;
	connectionId: string;
	sql: string;
}

export interface RunQueryResult {
	rows: Record<string, unknown>[];
	columns: string[];
}

export async function runQueryAction(input: RunQueryInput): Promise<RunQueryResult> {
	const connection = await resolveConnectionForQuery(input.connectionId, input.tenant);
	const secret = await getSecret(connection.id, input.tenant?.orgId);
	if (!input.tenant?.orgId) {
		assertCloudTenantRef(input.tenant ?? { orgId: '' }, 'Running a query');
		return queryExternalConnection(connection, secret ?? undefined, input.sql);
	}
	const availableConnections = await listConnectionsMetadata(input.tenant.orgId, {
		includePhysicalCatalogName: true
	});
	return queryExternalConnection(
		connection,
		secret ?? undefined,
		input.sql,
		undefined,
		input.tenant.orgId,
		availableConnections
	);
}

export interface RunPrqlInput {
	tenant?: TenantRef | null;
	connectionId: string;
	prql: string;
}

export async function runPrqlAction(input: RunPrqlInput): Promise<RunQueryResult> {
	const connection = await resolveConnectionForQuery(input.connectionId, input.tenant);

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

	const secret = await getSecret(connection.id, input.tenant?.orgId);
	if (!input.tenant?.orgId) {
		assertCloudTenantRef(input.tenant ?? { orgId: '' }, 'Running a PRQL query');
		return queryExternalConnection(connection, secret ?? undefined, sql);
	}
	const availableConnections = await listConnectionsMetadata(input.tenant.orgId, {
		includePhysicalCatalogName: true
	});
	return queryExternalConnection(
		connection,
		secret ?? undefined,
		sql,
		undefined,
		input.tenant.orgId,
		availableConnections
	);
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
export function resolveProjectFolder(
	folder: string | undefined,
	tenant?: TenantRef | null
): string {
	// Cloud/multi-tenant deployments: the folder is never client-controlled. It's derived
	// deterministically from the caller's active org+project, and any client-supplied
	// `folder` that doesn't match is rejected — otherwise an API key or MCP client from one
	// org could read/run/mutate another org's dbt project just by guessing/knowing its path.
	if (deploymentMode() === 'cloud') {
		if (!tenant?.orgId || !tenant?.projectId) {
			throw new Error('An active project is required for this action.');
		}
		const canonical = projectFolderFor(tenant.orgId, tenant.projectId);
		if (folder && path.resolve(folder) !== path.resolve(canonical)) {
			throw new Error('Project folder does not belong to the active tenant project.');
		}
		return canonical;
	}
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
	tenant?: TenantRef | null;
	folder?: string;
}

export interface ListNotebooksResult {
	notebooks: Array<{ id: string; name: string; folderId: string | null; cellCount: number }>;
	folders: NotebookFolder[];
}

export async function listNotebooksAction(input: ListNotebooksInput): Promise<ListNotebooksResult> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
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
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
}

export async function getNotebookAction(input: GetNotebookInput): Promise<{ notebook: Notebook }> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const { notebooks } = await walkProjectDirectory(folder);
	const notebook = notebooks.find((n) => n.id === input.notebookId);
	if (!notebook) throw new Error(`Notebook "${input.notebookId}" not found.`);
	return { notebook };
}

// ── dbt ──────────────────────────────────────────────────────────────────────

export interface DbtRunInput {
	tenant?: TenantRef | null;
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
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const args = ['run'];
	if (input.select) args.push('--select', input.select);
	return precompileAndSpawn(folder, args);
}

export async function dbtCompileAction(input: DbtRunInput): Promise<DbtJobResult> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
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
	tenant?: TenantRef | null;
	folder?: string;
}

export async function getDbtManifestAction(
	input: DbtManifestInput
): Promise<{ models: DbtModel[] }> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	return { models: await loadManifest(folder) };
}

// ── Notebook authoring (headless agent / MCP / REST — full parity with the
//    in-app AI chat's create_notebook/apply_notebook_patch/run_cells/etc, just
//    targeting project-folder .luna files on disk instead of browser state) ──

export interface CreateNotebookInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
	title?: string;
	planningIntent?: NotebookBlueprint['planningIntent'];
	qualityTarget?: NotebookBlueprint['qualityTarget'];
	autoRepair?: NotebookBlueprint['autoRepair'];
	executableCells?: McpExecutableCellInput[];
	blocks: NotebookBlueprint['blocks'];
}

export interface NotebookMutationOutput {
	diagnostics: NotebookBlueprintDiagnostic[];
	repairLog?: Array<{
		path: string;
		class: string;
		action: string;
		before?: unknown;
		after?: unknown;
	}>;
	notebook?: { id: string; name: string; folderId: string | null; cellCount: number };
}

function toMutationOutput(result: {
	diagnostics: NotebookBlueprintDiagnostic[];
	repairLog?: Array<{
		path: string;
		class: string;
		action: string;
		before?: unknown;
		after?: unknown;
	}>;
	notebook?: { id: string; name: string; folderId: string | null; cells: unknown[] };
}): NotebookMutationOutput {
	return {
		diagnostics: result.diagnostics,
		repairLog: result.repairLog,
		notebook: result.notebook
			? {
					id: result.notebook.id,
					name: result.notebook.name,
					folderId: result.notebook.folderId,
					cellCount: result.notebook.cells.length
				}
			: undefined
	};
}

export async function createNotebookAction(
	input: CreateNotebookInput
): Promise<NotebookMutationOutput> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const result = await createNotebookFromBlueprintOnDisk(
		folder,
		input.notebookId,
		{
			title: input.title,
			planningIntent: input.planningIntent,
			qualityTarget: input.qualityTarget,
			autoRepair: input.autoRepair,
			executableCells: input.executableCells,
			blocks: input.blocks
		},
		input.tenant
	);
	return toMutationOutput(result);
}

export interface PatchNotebookInput extends NotebookPatchInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
}

export async function patchNotebookAction(
	input: PatchNotebookInput
): Promise<NotebookMutationOutput> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const result = await patchNotebookOnDisk(
		folder,
		input.notebookId,
		{
			blueprint: input.blueprint,
			document: input.document,
			operations: input.operations,
			executableCells: input.executableCells,
			title: input.title
		},
		input.tenant
	);
	return toMutationOutput(result);
}

export interface ValidateNotebookInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
}

export async function validateNotebookAction(
	input: ValidateNotebookInput
): Promise<{ ok: boolean; diagnostics: NotebookBlueprintDiagnostic[] }> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const diagnostics = await validateNotebookOnDisk(folder, input.notebookId);
	return { ok: diagnostics.length === 0, diagnostics };
}

export async function inspectNotebookAction(input: ValidateNotebookInput) {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	return inspectNotebookOnDisk(folder, input.notebookId);
}

export interface RunNotebookCellsInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
	cellIds?: string[];
	allowPython: boolean;
}

export async function runNotebookCellsAction(
	input: RunNotebookCellsInput
): Promise<NotebookRunOutput> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	return runNotebookCellsOnDisk(folder, input.notebookId, input.cellIds, {
		allowPython: input.allowPython,
		tenant: input.tenant
	});
}

export interface SetChartInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
	cellId: string;
	chartConfig: ChartConfig | null;
}

export async function setChartAction(input: SetChartInput): Promise<NotebookMutationOutput> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const result = await setCellChartConfig(
		folder,
		input.notebookId,
		input.cellId,
		input.chartConfig
	);
	return toMutationOutput(result);
}

export interface PickChartInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
	cellId: string;
}

export async function pickChartAction(input: PickChartInput): Promise<NotebookMutationOutput> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const runOutput = await runNotebookCellsOnDisk(folder, input.notebookId, [input.cellId], {
		allowPython: false,
		tenant: input.tenant
	});
	const cellResult = runOutput.results[0];
	if (!cellResult || !cellResult.ok) {
		throw new Error(
			cellResult?.error ?? `Cell "${input.cellId}" could not be run to inspect its result.`
		);
	}
	const chartConfig = pickChartHeuristic(cellResult.rows ?? [], cellResult.columns ?? []);
	const result = await setCellChartConfig(folder, input.notebookId, input.cellId, chartConfig);
	return toMutationOutput(result);
}

export interface DeleteNotebookInput {
	tenant?: TenantRef | null;
	folder?: string;
	notebookId: string;
}

export async function deleteNotebookAction(
	input: DeleteNotebookInput
): Promise<NotebookMutationOutput> {
	const folder = resolveProjectFolder(input.folder, input.tenant);
	const result = await deleteNotebookOnDisk(folder, input.notebookId);
	return toMutationOutput(result);
}

// ── Shares / publishing ──────────────────────────────────────────────────────

export async function listSharesAction(tenant?: TenantRef | null): Promise<{
	shares: Array<{
		notebookId: string;
		notebookName: string;
		token: string;
		slug: string | null;
	}>;
}> {
	const { listActiveShares } = await import('./shared-reports.js');
	const shares = await listActiveShares(tenant);
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
	tenant?: TenantRef | null;
	notebookId: string;
}

export async function publishNotebookAction(
	input: PublishNotebookInput
): Promise<{ token: string; slug: string | null }> {
	const { loadWorkspaceState } = await import('./workspace-store.js');
	const { getShareByNotebookId, upsertShare } = await import('./shared-reports.js');
	const { buildShareSnapshot } = await import('$lib/services/share-snapshot');
	const { getSecret } = await import('./connection-secrets.js');

	const row = await loadWorkspaceState(input.tenant?.projectId ?? undefined);
	if (!row?.data) throw new Error('No workspace state on server.');
	const blob = row.data as { notebooks?: Notebook[]; connections?: Connection[] };
	const notebook = blob.notebooks?.find((n) => n.id === input.notebookId);
	if (!notebook) throw new Error(`Notebook "${input.notebookId}" not found in workspace.`);

	const snapshot = buildShareSnapshot(notebook, blob.connections ?? []);
	const existing = await getShareByNotebookId(input.notebookId, input.tenant);
	const connInputs = await Promise.all(
		snapshot.connections.map(async (conn) => ({
			connectionId: conn.connectionId,
			connection: conn.connection,
			secret: await getSecret(conn.connectionId, input.tenant?.orgId)
		}))
	);
	const share = await upsertShare({
		tenant: input.tenant,
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
	tenant?: TenantRef | null;
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
		tenant: input.tenant,
		siteId: input.siteId,
		pageSlug: input.pageSlug,
		navLabel: input.navLabel,
		shareToken: input.shareToken,
		notebookId: share?.notebookId ?? null
	});
	return { pageId: page.id };
}
