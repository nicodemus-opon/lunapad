import fs from 'node:fs/promises';
import path from 'node:path';
import { parseCellFile, serializeCell } from '$lib/services/prql-file';
import type { Cell, CellLanguage, Notebook, NotebookFolder } from '$lib/stores/notebook.svelte';
import { readSchemaFile, findSchemaFile, upsertModelEntry, writeSchemaFile } from './dbt-schema.js';

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
 * Walk `models/` and `analyses/` directories, parse each `.prql` file as a
 * cell, and return a notebook/folder tree mirroring the directory structure.
 *
 * Layout rules:
 * Each `.prql` file → single-cell notebook in its parent folder.
 * Directories → `NotebookFolder` entries. Folder IDs are relative paths from
 * the project root (e.g. `models/staging`), making them stable and path-resolvable.
 * Notebook IDs follow the same convention (`models/staging/stg_orders`).
 */
export async function walkProjectDirectory(folder: string): Promise<ProjectNotebooks> {
	const notebooks: Notebook[] = [];
	const folders: NotebookFolder[] = [];

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
					const notebook: Notebook = {
						id: notebookId,
						name: outputName,
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
					const notebook: Notebook = {
						id: notebookId,
						name: outputName,
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
	}

	// Analyses section: create a root "analyses" folder if the dir has content
	const analysesDir = path.join(folder, 'analyses');
	let hasAnalysesContent = false;
	try {
		const ae = await fs.readdir(analysesDir, { withFileTypes: true });
		hasAnalysesContent = ae.some(
			(e) => (e.isFile() && (e.name.endsWith('.prql') || e.name.endsWith('.sql'))) || (e.isDirectory() && !e.name.startsWith('.'))
		);
	} catch { /* no analyses dir */ }

	if (hasAnalysesContent) {
		folders.push({ id: 'analyses', name: 'analyses', parentId: null });
		await walkDir(analysesDir, 'analyses', 'analyses');
	}

	// Models section: top-level files/folders go directly under null parent
	await walkDir(path.join(folder, 'models'), 'models', null);

	// Post-process: append secondary cells to their target notebooks.
	// Files with a -- @notebook header belong to a multi-cell notebook rather than
	// being standalone notebooks themselves.
	for (const { targetNotebookId, cell } of secondaryCells) {
		const targetNb = notebooks.find((n) => n.id === targetNotebookId);
		if (targetNb) {
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
	await loadMissingModelsFromManifest(folder, notebookIds, notebooks, folders);

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
	folders: NotebookFolder[]
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

		const outputName = node.name;
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
			status: 'idle',
			result: null,
			errors: [],
			compiledSQL: null,
			executionMs: null,
			guiStages: [{ type: 'from', table: '' }],
			editMode: 'prql',
			resultViewMode: 'table',
			resultChartConfig: null,
			collapsed: false,
			stageResultsCollapsed: [],
			materializeMode: mat,
			materializeTarget: outputName,
			materializeStatus: 'idle',
			materializeError: null,
			materializedRelationType: null,
			description: node.description || null,
			dbtSchema: node.config?.schema ?? null,
			dbtTags: node.config?.tags ?? [],
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
		status: 'idle',
		result: null,
		errors: [],
		compiledSQL: null,
		executionMs: null,
		guiStages: parsed.meta.guiStages ?? [{ type: 'from', table: '' }],
		editMode: parsed.meta.editMode ?? (parsed.language === 'sql' ? 'prql' : 'gui'),
		resultViewMode: parsed.meta.resultViewMode ?? 'table',
		resultChartConfig: parsed.meta.chartConfig ?? null,
		collapsed: parsed.meta.collapsed ?? false,
		stageResultsCollapsed: parsed.meta.stageResultsCollapsed ?? [],
		materializeMode: ymlMaterialized,
		materializeTarget: outputName,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		description,
		dbtSchema: ymlSchema,
		dbtTags: ymlTags,
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
