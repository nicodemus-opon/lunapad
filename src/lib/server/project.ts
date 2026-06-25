import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseCellFile, serializeCell, stripRefs } from '$lib/services/prql-file';
import { parseLunaFile, type LunaEntry, type LunaQueryEntry } from '$lib/services/luna-file';
import { parseUdfSignature } from '$lib/services/udf';
import type { Cell, CellLanguage, Notebook, NotebookFolder } from '$lib/stores/notebook.svelte';
import { readSchemaFile, findSchemaFile, upsertModelEntry, writeSchemaFile } from './dbt-schema.js';
import { deconflictName } from '$lib/utils/deconflict';

/** Resolves `name` against `used` (deconflicting with `_copy`, `_copy2`, ... if
 *  already taken) and reserves the resolved name in `used`. Models discovered
 *  while walking a project must have project-wide unique outputNames — dbt
 *  itself requires globally unique model names for `ref()` to resolve. */
function claimOutputName(used: Set<string>, name: string): string {
	if (!name) return name;
	const claimed = deconflictName(used, name);
	used.add(claimed);
	return claimed;
}

/** Mutates `cell` in place so its id/outputName/materializeTarget agree after
 *  a (possible) `claimOutputName` rename. No-op for cells with no outputName
 *  (e.g. markdown cells, or UDF/query cells that already fell back to a
 *  crypto.randomUUID() id because their name couldn't be parsed). */
function claimCellOutputName(used: Set<string>, cell: Cell): void {
	if (!cell.outputName) return;
	const claimed = claimOutputName(used, cell.outputName);
	if (claimed !== cell.outputName) {
		cell.outputName = claimed;
		cell.id = claimed;
		cell.materializeTarget = claimed;
	}
}

export interface AuditResult {
	stubsAdded: string[];
}

export interface NotebookMeta {
	notebookName: string;
	cellOrder: string[];
}

export interface ProjectInfo {
	isDbtProject: boolean;
	isEvidenceProject: boolean;
	projectName: string | null;
	folder: string;
}

// ── Path safety ──────────────────────────────────────────────────────────────

/** Throws if `target` is not under `root`. */
export function assertSafe(root: string, target: string): void {
	const resolved = path.resolve(target);
	if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
		throw new Error(`Path "${target}" is outside the project folder`);
	}
}

// ── Project detection ────────────────────────────────────────────────────────

export async function detectProject(folder: string): Promise<ProjectInfo> {
	const dbtProjectFile = path.join(folder, 'dbt_project.yml');
	let isDbtProject = false;
	let projectName: string | null = null;

	try {
		const content = await fs.readFile(dbtProjectFile, 'utf-8');
		isDbtProject = true;
		const match = content.match(/^name\s*:\s*['"]?([^'"#\n]+)['"]?/m);
		projectName = match ? match[1].trim() : null;
	} catch {
		// not a dbt project
	}

	// Evidence.dev project: check for evidence.config.yaml or @evidence-dev/* in package.json
	let isEvidenceProject = false;
	try {
		await fs.access(path.join(folder, 'evidence.config.yaml'));
		isEvidenceProject = true;
	} catch {
		try {
			const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf-8')) as {
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			const deps = { ...pkg.dependencies, ...pkg.devDependencies };
			isEvidenceProject = Object.keys(deps).some((k) => k.startsWith('@evidence-dev/'));
		} catch {
			// not an Evidence project
		}
	}

	return { isDbtProject, isEvidenceProject, projectName, folder };
}

// ── Directory scaffolding ────────────────────────────────────────────────────

export async function scaffoldDbtProject(folder: string, name: string): Promise<void> {
	await fs.mkdir(folder, { recursive: true });

	// dbt best-practice folder structure:
	//   models/staging/   — views, one subdir per source system
	//   models/intermediate/ — ephemeral transforms
	//   models/marts/     — tables, one subdir per business domain
	//   analyses/         — ad-hoc queries (not materialized)
	const dbtProjectYml = `name: '${name}'
version: '1.0.0'
config-version: 2

profile: '${name}'

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

target-path: "target"
clean-targets:
  - "target"
  - "dbt_packages"

models:
  ${name}:
    staging:
      +materialized: view
    intermediate:
      +materialized: ephemeral
    marts:
      +materialized: table
`;

	const profilesYml = `${name}:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: ':memory:'
`;

	// Starter sources YAML for staging layer
	const sourcesYml = `version: 2

sources:
  - name: ${name}
    description: "Raw source tables for ${name}"
    tables: []
    # Add your source tables here:
    # - name: customers
    # - name: orders
`;

	// Starter models YAML for each layer
	const stagingModelsYml = `version: 2

models: []
  # - name: stg_${name}__example
  #   description: "Staging model for ..."
`;

	const martsModelsYml = `version: 2

models: []
  # - name: customers
  #   description: "Final customers mart"
`;

	const dirs = [
		path.join(folder, 'models', 'staging'),
		path.join(folder, 'models', 'intermediate'),
		path.join(folder, 'models', 'marts'),
		path.join(folder, 'analyses'),
		path.join(folder, 'tests'),
		path.join(folder, 'seeds'),
		path.join(folder, 'macros'),
		path.join(folder, 'snapshots')
	];

	await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })));

	await Promise.all([
		fs.writeFile(path.join(folder, 'dbt_project.yml'), dbtProjectYml, 'utf-8'),
		fs.writeFile(path.join(folder, 'profiles.yml'), profilesYml, 'utf-8'),
		fs.writeFile(path.join(folder, 'README.md'), `# ${name}\n\nA dbt project scaffolded by Lunapad.\n`, 'utf-8'),
		fs.writeFile(path.join(folder, 'models', 'staging', '_sources.yml'), sourcesYml, 'utf-8'),
		fs.writeFile(path.join(folder, 'models', 'staging', '_models.yml'), stagingModelsYml, 'utf-8'),
		fs.writeFile(path.join(folder, 'models', 'marts', '_models.yml'), martsModelsYml, 'utf-8')
	]);
}

// ── Directory walking ────────────────────────────────────────────────────────

export interface ProjectNotebooks {
	notebooks: Notebook[];
	folders: NotebookFolder[];
}

/**
 * Walk `models/` and `analyses/` directories and return a notebook/folder
 * tree mirroring the directory structure.
 *
 * Layout rules:
 * Each `.prql`/standalone `.sql` file → single-cell ("flat") notebook in its
 * parent folder — this is the compiled-out representation for cells promoted
 * to a standalone dbt model.
 * Each `.luna` file → a multi-cell ("luna") notebook in its parent folder —
 * the default authoring format (prose + query cells, document order). No
 * name collision with flat files since the extension differs.
 * Directories → `NotebookFolder` entries. Folder IDs are relative paths from
 * the project root (e.g. `models/staging`), making them stable and path-resolvable.
 * Notebook IDs follow the same convention (`models/staging/stg_orders`).
 */
export async function walkProjectDirectory(folder: string): Promise<ProjectNotebooks> {
	const notebooks: Notebook[] = [];
	const folders: NotebookFolder[] = [];

	// Tracks every outputName claimed so far across the whole project (not just
	// the current notebook) — dbt model names must be globally unique, and the
	// app's own dependency resolution (cell-deps.ts, getGlobalOutputRegistry)
	// resolves outputNames project-wide too. Collisions found while walking
	// (e.g. two files with the same name in different folders) are deconflicted
	// here, at load time, rather than silently producing duplicate cell ids.
	const usedOutputNames = new Set<string>();

	// Collected during the walk: cells that belong to another notebook via @notebook header.
	// Appended in a post-processing pass after all standalone notebooks are built.
	const secondaryCells: Array<{ targetNotebookId: string; cell: Cell }> = [];

	/**
	 * Recursively walk a directory.
	 * @param absDir   Absolute path of the directory to walk.
	 * @param relDir   Relative path from project root (e.g. "models/staging").
	 * @param parentFolderId  The folder ID of the parent, or null for top-level.
	 */
	async function walkDir(absDir: string, relDir: string, parentFolderId: string | null): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(absDir, { withFileTypes: true });
		} catch {
			return; // directory doesn't exist yet
		}

		const subdirs = entries
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.sort((a, b) => a.name.localeCompare(b.name));

		const prqlFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith('.prql'))
			.sort((a, b) => a.name.localeCompare(b.name));

		// SQL files that don't have a same-named .prql file (i.e. not compiled dbt output)
		const prqlBaseNames = new Set(prqlFiles.map((e) => e.name.replace(/\.prql$/, '')));
		const sqlOnlyFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith('.sql') && !prqlBaseNames.has(e.name.replace(/\.sql$/, '')))
			.sort((a, b) => a.name.localeCompare(b.name));

		// `.luna` multi-cell notebooks — the default authoring format, living
		// alongside flat .prql/.sql files (no name collision since the extension differs).
		const lunaFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith('.luna'))
			.sort((a, b) => a.name.localeCompare(b.name));

		// Each subdirectory → NotebookFolder + recurse
		for (const dir of subdirs) {
			const childRelDir = `${relDir}/${dir.name}`;
			folders.push({ id: childRelDir, name: dir.name, parentId: parentFolderId });
			await walkDir(path.join(absDir, dir.name), childRelDir, childRelDir);
		}

		// Each .prql file → either a standalone notebook or a secondary cell of another notebook
		for (const file of prqlFiles) {
			const outputName = file.name.replace(/\.prql$/, '');
			const notebookId = `${relDir}/${outputName}`;
			const filePath = path.join(absDir, file.name);
			try {
				const { cell, notebookId: targetNbId } = await readCellFile(filePath, outputName, 0, folder, 'prql');
				if (targetNbId) {
					// Secondary cell: belongs to another notebook via @notebook annotation
					secondaryCells.push({ targetNotebookId: targetNbId, cell });
				} else {
					claimCellOutputName(usedOutputNames, cell);
					const notebook: Notebook = {
						id: notebookId,
						name: cell.outputName,
						folderId: parentFolderId,
						defaultCellLanguage: cell.language,
						cells: [cell]
					};
					notebooks.push(notebook);
				}
			} catch {
				// skip unreadable files
			}
		}

		// Each SQL-only .sql file → standalone or secondary cell
		for (const file of sqlOnlyFiles) {
			const outputName = file.name.replace(/\.sql$/, '');
			const notebookId = `${relDir}/${outputName}`;
			const filePath = path.join(absDir, file.name);
			try {
				const { cell, notebookId: targetNbId } = await readCellFile(filePath, outputName, 0, folder, 'sql');
				if (targetNbId) {
					secondaryCells.push({ targetNotebookId: targetNbId, cell });
				} else {
					claimCellOutputName(usedOutputNames, cell);
					const notebook: Notebook = {
						id: notebookId,
						name: cell.outputName,
						folderId: parentFolderId,
						defaultCellLanguage: cell.language,
						cells: [cell]
					};
					notebooks.push(notebook);
				}
			} catch {
				// skip unreadable files
			}
		}

		// Each `.luna` file → a single multi-cell notebook (cell order = document order)
		for (const file of lunaFiles) {
			const name = file.name.replace(/\.luna$/, '');
			const notebookId = `${relDir}/${name}`;
			try {
				const content = await fs.readFile(path.join(absDir, file.name), 'utf-8');
				const cells = await hydrateLunaEntries(parseLunaFile(content).entries, folder, usedOutputNames);
				notebooks.push({
					id: notebookId,
					name,
					folderId: parentFolderId,
					format: 'luna',
					defaultCellLanguage: cells.find((c) => c.cellType === 'query')?.language ?? 'prql',
					cells
				});
			} catch {
				// skip unreadable/unparseable files
			}
		}
	}

	// Analyses section: create a root "analyses" folder if the dir has content
	const analysesDir = path.join(folder, 'analyses');
	let hasAnalysesContent = false;
	try {
		const ae = await fs.readdir(analysesDir, { withFileTypes: true });
		hasAnalysesContent = ae.some(
			(e) =>
				(e.isFile() && (e.name.endsWith('.prql') || e.name.endsWith('.sql') || e.name.endsWith('.luna'))) ||
				(e.isDirectory() && !e.name.startsWith('.'))
		);
	} catch { /* no analyses dir */ }

	if (hasAnalysesContent) {
		folders.push({ id: 'analyses', name: 'analyses', parentId: null });
		await walkDir(analysesDir, 'analyses', 'analyses');
	}

	// Models section: top-level files/folders go directly under null parent
	await walkDir(path.join(folder, 'models'), 'models', null);

	// Notebooks section: `.luna` multi-cell notebooks, parallel to models/analyses.
	await walkNotebooksDirectory(folder, notebooks, folders, usedOutputNames);

	// Post-process: append secondary cells to their target notebooks.
	// Files with a -- @notebook header belong to a multi-cell notebook rather than
	// being standalone notebooks themselves.
	for (const { targetNotebookId, cell } of secondaryCells) {
		const targetNb = notebooks.find((n) => n.id === targetNotebookId);
		if (targetNb) {
			claimCellOutputName(usedOutputNames, cell);
			targetNb.cells.push(cell);
		}
		// If the target notebook doesn't exist (e.g. its primary file is missing),
		// the secondary cell is silently dropped — it will reappear once the
		// primary file is restored or created.
	}

	// Manifest fallback: load models whose source files are missing from disk.
	// This covers dbt projects where .sql source files were deleted or never
	// committed — the raw_code in the manifest is the original source SQL.
	const notebookIds = new Set(notebooks.map((n) => n.id));
	await loadMissingModelsFromManifest(folder, notebookIds, notebooks, folders, usedOutputNames);

	return { notebooks, folders };
}

interface ManifestNode {
	name: string;
	original_file_path?: string;
	path?: string;
	resource_type?: string;
	raw_code?: string;
	config?: { materialized?: string; schema?: string; tags?: string[] };
	description?: string;
	depends_on?: { nodes?: string[] };
}

/**
 * Read target/manifest.json and create notebooks for any models whose
 * source files don't already appear in the notebooks array.
 * Uses raw_code (source SQL with {{ ref() }} intact) as the cell content.
 */
async function loadMissingModelsFromManifest(
	folder: string,
	existingNotebookIds: Set<string>,
	notebooks: Notebook[],
	folders: NotebookFolder[],
	usedOutputNames: Set<string>
): Promise<void> {
	let manifest: { nodes?: Record<string, ManifestNode> };
	try {
		const raw = await fs.readFile(path.join(folder, 'target', 'manifest.json'), 'utf-8');
		manifest = JSON.parse(raw) as typeof manifest;
	} catch {
		return; // no manifest — nothing to do
	}

	const nodes = manifest.nodes ?? {};
	const existingFolderIds = new Set(folders.map((f) => f.id));

	for (const node of Object.values(nodes)) {
		if (node.resource_type !== 'model') continue;
		if (!node.raw_code?.trim() || !node.original_file_path) continue;

		// original_file_path: "models/staging/links/stg_links__links.sql"
		// notebookId: "models/staging/links/stg_links__links"
		const relPath = node.original_file_path; // e.g. models/marts/cert_demand.sql
		const notebookId = relPath.replace(/\.(prql|sql)$/, '');
		if (existingNotebookIds.has(notebookId)) continue;

		// Strip {{ config(...) }} Jinja block from raw_code (dbt-specific, not needed in editor).
		// Use [\s\S]*? to handle multi-line config blocks.
		let code = node.raw_code.replace(/\{\{-?\s*config\([\s\S]*?\)\s*-?\}\}\s*/g, '').trim();

		// Extract materialization from config block
		const matMap: Record<string, 'table' | 'view' | 'incremental' | 'ephemeral'> = {
			table: 'table', view: 'view', incremental: 'incremental', ephemeral: 'ephemeral'
		};
		const mat = matMap[node.config?.materialized ?? ''] ?? 'table';

		const outputName = claimOutputName(usedOutputNames, node.name);
		// folderId = parent directory of the model (e.g. "models/staging/links")
		const parts = notebookId.split('/');
		const folderId = parts.length > 2 ? parts.slice(0, -1).join('/') : null;

		// Ensure the folder chain exists in the folders array
		if (folderId && !existingFolderIds.has(folderId)) {
			const segments = folderId.split('/').slice(1); // drop 'models'
			let currentId = 'models';
			// Ensure each ancestor folder exists
			// (outer loop already created 'models' implicitly via walkDir, but not sub-folders)
			for (const seg of segments) {
				const childId = `${currentId}/${seg}`;
				if (!existingFolderIds.has(childId)) {
					folders.push({ id: childId, name: seg, parentId: currentId === 'models' ? null : currentId });
					existingFolderIds.add(childId);
				}
				currentId = childId;
			}
		}

		const cell: Cell = {
			id: outputName,
			cellType: 'query',
			language: 'sql',
			connectionId: null,
			outputName,
			code,
			markdown: '',
			markdownPreview: false,
			udfBody: '',
			status: 'idle',
			result: null,
			errors: [],
			compiledSQL: null,
			executionMs: null,
			guiStages: [{ type: 'from', table: '' }],
			editMode: 'prql',
			resultViewMode: 'table',
			resultChartConfig: null,
			display: 'full',
			stageResultsCollapsed: [],
			materializeMode: mat,
			materializeTarget: outputName,
			materializeStatus: 'idle',
			materializeError: null,
			materializedRelationType: null,
			description: node.description || null,
			dbtSchema: node.config?.schema ?? null,
			dbtTags: node.config?.tags ?? [],
			promotedModelPath: null,
			dbtTestStatus: 'idle',
			dbtTestResults: [],
			dbtTestLog: [],
			scheduleEnabled: false,
			scheduleIntervalMinutes: 60,
			scheduleScope: 'cell',
			scheduleStatus: 'idle',
			scheduleLastRunAt: null,
			scheduleNextRunAt: null,
			scheduleLastError: null,
			intelligence: null,
			needsRun: false,
			staleReason: null,
			staleSources: [],
			lastRunAt: null
		};

		const notebook: Notebook = {
			id: notebookId,
			name: outputName,
			folderId: folderId ?? null,
			defaultCellLanguage: 'sql',
			cells: [cell]
		};

		notebooks.push(notebook);
		existingNotebookIds.add(notebookId);
	}
}

// ── `.luna` multi-cell notebooks ─────────────────────────────────────────────

/**
 * Walk the legacy `notebooks/` directory, parsing each `.luna` file as a
 * single multi-cell notebook (cell order = document order). `.luna` files are
 * now primarily authored directly inside `models/**`/`analyses/**` (see
 * `walkDir` above) — this dedicated directory only remains for backward
 * compatibility with `.luna` files already placed here before that.
 */
async function walkNotebooksDirectory(
	folder: string,
	notebooks: Notebook[],
	folders: NotebookFolder[],
	usedOutputNames: Set<string>
): Promise<void> {
	const notebooksDir = path.join(folder, 'notebooks');
	let hasContent = false;
	try {
		const entries = await fs.readdir(notebooksDir, { withFileTypes: true });
		hasContent = entries.some(
			(e) => (e.isFile() && e.name.endsWith('.luna')) || (e.isDirectory() && !e.name.startsWith('.'))
		);
	} catch {
		return; // no notebooks dir yet
	}
	if (!hasContent) return;

	folders.push({ id: 'notebooks', name: 'notebooks', parentId: null });

	async function walk(absDir: string, relDir: string, parentFolderId: string | null): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(absDir, { withFileTypes: true });
		} catch {
			return;
		}

		const subdirs = entries
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const dir of subdirs) {
			const childRelDir = `${relDir}/${dir.name}`;
			folders.push({ id: childRelDir, name: dir.name, parentId: parentFolderId });
			await walk(path.join(absDir, dir.name), childRelDir, childRelDir);
		}

		const lunaFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith('.luna'))
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const file of lunaFiles) {
			const name = file.name.replace(/\.luna$/, '');
			const notebookId = `${relDir}/${name}`;
			try {
				const content = await fs.readFile(path.join(absDir, file.name), 'utf-8');
				const cells = await hydrateLunaEntries(parseLunaFile(content).entries, folder, usedOutputNames);
				notebooks.push({
					id: notebookId,
					name,
					folderId: parentFolderId,
					format: 'luna',
					defaultCellLanguage: cells.find((c) => c.cellType === 'query')?.language ?? 'prql',
					cells
				});
			} catch {
				// skip unreadable/unparseable files
			}
		}
	}

	await walk(notebooksDir, 'notebooks', 'notebooks');
}

/** Find a model's source file (`<name>.prql` or `<name>.sql`) under models/ or analyses/. */
async function findModelFilePath(projectFolder: string, modelName: string): Promise<string | null> {
	async function search(dir: string): Promise<string | null> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return null;
		}
		for (const e of entries) {
			if (e.isDirectory() && !e.name.startsWith('.')) {
				const found = await search(path.join(dir, e.name));
				if (found) return found;
			} else if (e.isFile() && (e.name === `${modelName}.prql` || e.name === `${modelName}.sql`)) {
				return path.join(dir, e.name);
			}
		}
		return null;
	}

	for (const root of ['models', 'analyses']) {
		const found = await search(path.join(projectFolder, root));
		if (found) return path.relative(projectFolder, found);
	}
	return null;
}

/** Convert parsed `.luna` entries into Cells, hydrating `model` ref placeholders
 *  from the real model file so they participate in dependency resolution
 *  (cell-deps.ts) exactly like any other cell. */
async function hydrateLunaEntries(
	entries: LunaEntry[],
	projectRoot: string,
	usedOutputNames: Set<string>
): Promise<Cell[]> {
	const cells: Cell[] = [];
	for (const entry of entries) {
		if (entry.kind === 'markdown') {
			cells.push(buildMarkdownCell(entry.markdown));
			continue;
		}
		if (entry.kind === 'query') {
			const cell = buildQueryCellFromLuna(entry);
			claimCellOutputName(usedOutputNames, cell);
			cells.push(cell);
			continue;
		}
		if (entry.kind === 'udf') {
			const cell = buildUdfCellFromLuna(entry.udfBody);
			claimCellOutputName(usedOutputNames, cell);
			cells.push(cell);
			continue;
		}
		if (entry.kind === 'plot') {
			const cell = buildPlotCellFromLuna(entry.name, entry.code);
			claimCellOutputName(usedOutputNames, cell);
			cells.push(cell);
			continue;
		}
		// modelRef: hydrate the real cell from its promoted model file. This
		// intentionally mirrors the same outputName/id as the standalone model
		// cell elsewhere in the project — it's the same logical model, not a
		// collision — so it's deliberately NOT passed through claimCellOutputName.
		const relPath = await findModelFilePath(projectRoot, entry.ref);
		if (relPath) {
			try {
				const fileLanguage: CellLanguage = relPath.endsWith('.sql') ? 'sql' : 'prql';
				const { cell } = await readCellFile(path.join(projectRoot, relPath), entry.ref, 0, projectRoot, fileLanguage);
				cells.push({ ...cell, promotedModelPath: relPath });
				continue;
			} catch {
				// fall through to stub below
			}
		}
		// Model file missing — keep a stub so the notebook doesn't silently lose the cell.
		const stub = buildQueryCellFromLuna({
			kind: 'query',
			name: entry.ref,
			lang: 'sql',
			connection: null,
			materialized: 'table',
			schema: null,
			tags: [],
			meta: {},
			code: ''
		});
		claimCellOutputName(usedOutputNames, stub);
		cells.push({ ...stub, promotedModelPath: relPath ?? '' });
	}
	return cells;
}

function buildUdfCellFromLuna(udfBody: string): Cell {
	const sig = parseUdfSignature(udfBody);
	const outputName = 'error' in sig ? '' : sig.name;
	return {
		id: outputName || crypto.randomUUID(),
		cellType: 'udf',
		language: 'sql',
		connectionId: null,
		outputName,
		code: '',
		markdown: '',
		markdownPreview: false,
		udfBody,
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [{ type: 'from', table: '' }],
		editMode: 'prql',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: outputName,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null
	};
}

function buildPlotCellFromLuna(name: string, code: string): Cell {
	return {
		id: name || crypto.randomUUID(),
		cellType: 'plot',
		language: 'prql',
		connectionId: null,
		outputName: name,
		code,
		markdown: '',
		markdownPreview: false,
		udfBody: '',
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [{ type: 'from', table: '' }],
		editMode: 'prql',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: '',
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null
	};
}

function buildMarkdownCell(markdown: string): Cell {
	return {
		id: crypto.randomUUID(),
		cellType: 'markdown',
		language: 'prql',
		connectionId: null,
		outputName: '',
		code: '',
		markdown,
		markdownPreview: false,
		udfBody: '',
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: [{ type: 'from', table: '' }],
		editMode: 'prql',
		resultViewMode: 'table',
		resultChartConfig: null,
		display: 'full',
		stageResultsCollapsed: [],
		materializeMode: 'table',
		materializeTarget: '',
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: null,
		dbtTags: [],
		promotedModelPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: false,
		scheduleIntervalMinutes: 60,
		scheduleScope: 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null
	};
}

export function buildQueryCellFromLuna(entry: LunaQueryEntry): Cell {
	return {
		id: entry.name || crypto.randomUUID(),
		cellType: 'query',
		language: entry.lang,
		connectionId: entry.connection,
		outputName: entry.name,
		code: entry.lang === 'prql' ? stripRefs(entry.code) : entry.code,
		markdown: '',
		markdownPreview: false,
		udfBody: '',
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: entry.meta.guiStages ?? [{ type: 'from', table: '' }],
		editMode: entry.meta.editMode ?? (entry.lang === 'sql' ? 'prql' : 'gui'),
		resultViewMode: entry.meta.resultViewMode ?? 'table',
		resultChartConfig: entry.meta.chartConfig ?? null,
		display: entry.meta.display ?? 'full',
		stageResultsCollapsed: entry.meta.stageResultsCollapsed ?? [],
		materializeMode: entry.materialized,
		materializeTarget: entry.name,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description: null,
		dbtSchema: entry.schema,
		dbtTags: entry.tags,
		promotedModelPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: entry.meta.scheduleEnabled ?? false,
		scheduleIntervalMinutes: entry.meta.scheduleIntervalMinutes ?? 60,
		scheduleScope: entry.meta.scheduleScope ?? 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null
	};
}

// ── Single file I/O ──────────────────────────────────────────────────────────

async function readCellFile(
	filePath: string,
	outputName: string,
	index: number,
	projectRoot?: string,
	fileLanguage: CellLanguage = 'prql'
): Promise<{ cell: Cell; notebookId: string | null }> {
	const content = await fs.readFile(filePath, 'utf-8');
	const parsed = parseCellFile(content, fileLanguage);

	// Load description (and yml-authoritative config) from _models.yml if available
	let description: string | null = null;
	let ymlSchema: string | null = parsed.dbtSchema;
	let ymlTags: string[] = parsed.dbtTags;
	let ymlMaterialized = parsed.materializeMode;
	if (projectRoot) {
		try {
			const modelRelPath = path.relative(projectRoot, filePath);
			const ymlPath = findSchemaFile(projectRoot, modelRelPath);
			const schema = await readSchemaFile(ymlPath);
			const ymlModel = schema.models.find((m) => m.name === outputName);
			if (ymlModel) {
				description = ymlModel.description ?? null;
				if (ymlModel.config?.schema) ymlSchema = ymlModel.config.schema;
				if (ymlModel.config?.tags?.length) ymlTags = ymlModel.config.tags;
				if (ymlModel.config?.materialized) {
					ymlMaterialized = ymlModel.config.materialized as typeof ymlMaterialized;
				}
			}
		} catch {
			// yml not available — fall back to .prql headers
		}
	}

	const cell: Cell = {
		id: outputName, // stable ID = outputName for file-backed cells
		cellType: parsed.cellType,
		language: parsed.language,
		connectionId: parsed.connectionId,
		outputName,
		code: parsed.code,
		markdown: parsed.markdown,
		markdownPreview: false,
		udfBody: '',
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: parsed.meta.guiStages ?? [{ type: 'from', table: '' }],
		editMode: parsed.meta.editMode ?? (parsed.language === 'sql' ? 'prql' : 'gui'),
		resultViewMode: parsed.meta.resultViewMode ?? 'table',
		resultChartConfig: parsed.meta.chartConfig ?? null,
		display: parsed.meta.display ?? (parsed.meta.collapsed ? 'collapsed' : 'full'),
		stageResultsCollapsed: parsed.meta.stageResultsCollapsed ?? [],
		materializeMode: ymlMaterialized,
		materializeTarget: outputName,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description,
		dbtSchema: ymlSchema,
		dbtTags: ymlTags,
		promotedModelPath: null,
		dbtTestStatus: 'idle',
		dbtTestResults: [],
		dbtTestLog: [],
		scheduleEnabled: parsed.meta.scheduleEnabled ?? false,
		scheduleIntervalMinutes: parsed.meta.scheduleIntervalMinutes ?? 60,
		scheduleScope: parsed.meta.scheduleScope ?? 'cell',
		scheduleStatus: 'idle',
		scheduleLastRunAt: null,
		scheduleNextRunAt: null,
		scheduleLastError: null,
		intelligence: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null
	};

	return { cell, notebookId: parsed.notebookId };
}

/**
 * Read a single `.prql` or `.sql` file as a single-cell notebook.
 */
export async function readNotebookFile(
	filePath: string,
	outputName: string,
	folderId: string | null,
	projectRoot?: string,
	fileLanguage: CellLanguage = 'prql'
): Promise<Notebook> {
	const { cell } = await readCellFile(filePath, outputName, 0, projectRoot, fileLanguage);
	return {
		id: outputName,
		name: outputName,
		folderId,
		defaultCellLanguage: cell.language,
		cells: [cell]
	};
}

/**
 * Write a single cell's `.prql` file to disk.
 * Creates parent directories as needed.
 */
export async function writeCellFile(
	filePath: string,
	cell: Cell,
	knownModels: string[] = []
): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const content = serializeCell(cell, knownModels);
	await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Write (or update) `.lunapad.json` metadata for a multi-cell notebook.
 */
export async function writeNotebookMeta(dirPath: string, meta: NotebookMeta): Promise<void> {
	await fs.mkdir(dirPath, { recursive: true });
	await fs.writeFile(
		path.join(dirPath, '.lunapad.json'),
		JSON.stringify(meta, null, 2),
		'utf-8'
	);
}

/**
 * Delete a `.prql` file and its companion `.sql` artifact, then remove the
 * parent directory if it is now empty.
 */
export async function deleteCellFile(filePath: string): Promise<void> {
	await fs.unlink(filePath);
	// Remove companion compiled .sql so dbt doesn't see a ghost model
	if (filePath.endsWith('.prql')) {
		try { await fs.unlink(filePath.replace(/\.prql$/, '.sql')); } catch { /* no companion */ }
	}
	// Remove parent dir if now empty (ignoring .lunapad.json)
	const dir = path.dirname(filePath);
	try {
		const remaining = await fs.readdir(dir);
		const meaningful = remaining.filter((f) => f !== '.lunapad.json');
		if (meaningful.length === 0) {
			await fs.rm(dir, { recursive: true });
		}
	} catch {
		// ignore
	}
}

/**
 * Rename or move a `.prql` file, carrying its companion `.sql` artifact along.
 */
export async function renameCellFile(oldPath: string, newPath: string): Promise<void> {
	if (path.resolve(oldPath) !== path.resolve(newPath)) {
		const exists = await fs.stat(newPath).then(
			() => true,
			() => false
		);
		if (exists) throw new Error(`A file already exists at "${path.basename(newPath)}"`);
	}
	await fs.mkdir(path.dirname(newPath), { recursive: true });
	await fs.rename(oldPath, newPath);
	if (oldPath.endsWith('.prql') && newPath.endsWith('.prql')) {
		const oldSql = oldPath.replace(/\.prql$/, '.sql');
		const newSql = newPath.replace(/\.prql$/, '.sql');
		try { await fs.rename(oldSql, newSql); } catch { /* no companion */ }
	}
}

/**
 * Walk the project's `models/` tree and:
 *   - Add stub `_models.yml` entries for `.prql` files that have no entry yet.
 *   - Delete orphaned `.sql` files (companion has no matching `.prql`).
 *
 * Safe to call on project open — additive for YML, destructive only for
 * generated `.sql` artifacts that have no source `.prql` to regenerate from.
 */
export async function auditAndFixProjectYmls(projectFolder: string): Promise<AuditResult> {
	const stubsAdded: string[] = [];

	async function auditDir(absDir: string): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(absDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory() && !entry.name.startsWith('.')) {
				await auditDir(path.join(absDir, entry.name));
			}
		}

		const prqlNames = new Set<string>();
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith('.prql')) prqlNames.add(entry.name.slice(0, -5));
		}

		// Stub _models.yml entries for .prql files not yet registered
		if (prqlNames.size > 0) {
			const ymlPath = path.join(absDir, '_models.yml');
			const schema = await readSchemaFile(ymlPath);
			let updated = schema;
			for (const name of prqlNames) {
				if (!schema.models.find((m) => m.name === name)) {
					updated = upsertModelEntry(updated, name, { description: '' });
					stubsAdded.push(name);
				}
			}
			if (updated !== schema) await writeSchemaFile(ymlPath, updated);
		}
	}

	await auditDir(path.join(projectFolder, 'models'));
	return { stubsAdded };
}
