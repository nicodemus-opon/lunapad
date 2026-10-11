import fs from 'node:fs/promises';
import path from 'node:path';
import { readSchemaFile, findSchemaFile, upsertModelEntry, writeSchemaFile } from './dbt-schema.js';
import { assertAllowedProjectFolder } from './project.js';

export interface DbtModel {
	name: string;
	schema: string;
	description: string | null;
	columns: { name: string; dataType: string; description: string | null; tests: string[] }[];
	upstreamRefs: string[];
	materialized: 'table' | 'view' | 'incremental' | 'ephemeral';
	lastRunStatus: 'pass' | 'error' | 'unknown';
	path: string; // relative path within models/
	tags: string[];
}

interface ManifestNode {
	name: string;
	schema: string;
	description?: string;
	config?: { materialized?: string; tags?: string[] };
	columns?: Record<
		string,
		{
			name: string;
			data_type?: string;
			description?: string;
			tests?: Record<string, unknown>;
			data_tests?: Record<string, unknown>;
		}
	>;
	depends_on?: { nodes?: string[] };
	tags?: string[];
	path?: string;
	resource_type?: string;
}

interface Manifest {
	nodes?: Record<string, ManifestNode>;
}

interface RunResults {
	results?: Array<{ unique_id: string; status: string }>;
}

/**
 * `node.path` means different things depending on the dbt flavour: dbt-core emits
 * it relative to the model root ("staging/orders.sql") while dbt-fusion keeps the
 * model-path prefix ("models/staging/orders.sql"). Everything downstream assumes
 * the dbt-core form, so normalize once. Without this, `backfillColumnsFromManifest`
 * re-joins "models" onto an already-prefixed path and writes into a phantom
 * `models/models/` tree inside the user's project.
 */
function stripModelPathPrefix(nodePath: string, modelPaths: string[]): string {
	let rel = nodePath.replace(/\\/g, '/');
	for (const raw of modelPaths) {
		const prefix = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
		if (!prefix) continue;
		if (rel === prefix) return '';
		if (rel.startsWith(`${prefix}/`)) return rel.slice(prefix.length + 1);
	}
	return rel;
}

/** dbt tags may arrive as an array or as a space-separated string (e.g. `+tags: "a b"`). */
function normalizeTags(raw: string[] | string | undefined | null): string[] {
	if (!raw) return [];
	const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/);
	return [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
}

/** Read `model-paths` from dbt_project.yml; defaults to ["models"] like dbt does. */ async function readModelPaths(
	projectRoot: string
): Promise<string[]> {
	try {
		const content = await fs.readFile(path.join(projectRoot, 'dbt_project.yml'), 'utf-8');
		const match = content.match(/^[ \t]*model-paths[ \t]*:[ \t]*\[([^\]]*)\]/m);
		if (match) {
			const parsed = match[1]
				.split(',')
				.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
				.filter(Boolean);
			if (parsed.length) return parsed;
		}
	} catch {
		// unreadable/missing — fall back to dbt's default
	}
	return ['models'];
}

// ── Manifest parsing ─────────────────────────────────────────────────────────

export async function loadManifest(projectRoot: string): Promise<DbtModel[]> {
	assertAllowedProjectFolder(projectRoot);
	const manifestPath = path.join(projectRoot, 'target', 'manifest.json');
	const runResultsPath = path.join(projectRoot, 'target', 'run_results.json');

	let manifest: Manifest = {};
	let runResults: RunResults = {};

	try {
		manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Manifest;
	} catch {
		// manifest not yet generated — fall back to file scan
		return parseModelFiles(projectRoot);
	}

	try {
		runResults = JSON.parse(await fs.readFile(runResultsPath, 'utf-8')) as RunResults;
	} catch {
		// optional
	}

	const modelPaths = await readModelPaths(projectRoot);

	// Build run status map
	const statusMap = new Map<string, 'pass' | 'error'>();
	for (const result of runResults.results ?? []) {
		statusMap.set(result.unique_id, result.status === 'success' ? 'pass' : 'error');
	}

	// Keyed by `path` (not `name`) — dbt model names must be unique project-wide,
	// but a stale manifest can transiently contain two nodes with the same name
	// (e.g. mid-rename); a duplicate `name` would crash Svelte's keyed each-blocks
	// in DbtLineageView. `path` is the one field guaranteed unique per model file.
	const models = new Map<string, DbtModel>();
	for (const [nodeId, node] of Object.entries(manifest.nodes ?? {})) {
		if (node.resource_type !== 'model') continue;

		const upstreamRefs: string[] = [];
		for (const dep of node.depends_on?.nodes ?? []) {
			// dep is like "model.project_name.orders_clean" (or
			// "model.project_name.orders_clean.v1" for versioned models).
			const parts = dep.split('.');
			if (parts[0] === 'model' && parts.length >= 3) {
				upstreamRefs.push(parts[2]);
			}
		}

		// dbt-core records tests as a keyed object (`{ not_null: {...} }`); dbt-fusion
		// uses the same shape under `data_tests` for dbt >= 1.10. Previously this was
		// hardcoded to `[]`, which made the lineage "tested" badge unreachable for any
		// project read from a manifest.
		const columns = Object.values(node.columns ?? {}).map((col) => {
			const tests = col.tests ?? col.data_tests ?? {};
			return {
				name: col.name,
				dataType: col.data_type ?? 'unknown',
				description: col.description ?? null,
				tests: Array.isArray(tests) ? tests : Object.keys(tests)
			};
		});

		models.set(node.path ? stripModelPathPrefix(node.path, modelPaths) : nodeId, {
			name: node.name,
			schema: node.schema ?? '',
			description: node.description ?? null,
			columns,
			upstreamRefs,
			materialized: (node.config?.materialized ?? 'view') as DbtModel['materialized'],
			lastRunStatus: statusMap.get(nodeId) ?? 'unknown',
			// Fall back to the manifest node id (unique per node) when the
			// node carries no path — an empty-string path would collide across
			// nodes and crash Svelte's keyed each-blocks downstream.
			path: node.path ? stripModelPathPrefix(node.path, modelPaths) : nodeId,
			tags: normalizeTags(node.tags ?? node.config?.tags)
		});
	}

	return Array.from(models.values());
}

/**
 * Fallback: scan `models/` for `.prql` and `.sql` files and extract model
 * names / {{ ref() }} dependencies without a compiled manifest.
 */
async function parseModelFiles(projectRoot: string): Promise<DbtModel[]> {
	const modelsDir = path.join(projectRoot, 'models');
	const models: DbtModel[] = [];

	async function walk(dir: string): Promise<void> {
		let entries: import('node:fs').Dirent[];
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				await walk(path.join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith('.prql') && !entry.name.endsWith('.sql')) continue;

			const filePath = path.join(dir, entry.name);
			const name = entry.name.replace(/\.(prql|sql)$/, '');

			try {
				const content = await fs.readFile(filePath, 'utf-8');
				const refs = extractRefs(content);
				const relPath = path.relative(modelsDir, filePath);

				// Try to load description + columns from _models.yml
				const ymlPath = findSchemaFile(projectRoot, path.join('models', relPath));
				const schema = await readSchemaFile(ymlPath);
				const ymlModel = schema.models.find((m) => m.name === name);

				models.push({
					name,
					schema: ymlModel?.config?.schema ?? '',
					description: ymlModel?.description ?? null,
					columns: (ymlModel?.columns ?? []).map((c) => ({
						name: c.name,
						dataType: 'unknown',
						description: c.description ?? null,
						tests: c.tests ?? []
					})),
					upstreamRefs: refs,
					materialized: (ymlModel?.config?.materialized ?? 'view') as DbtModel['materialized'],
					lastRunStatus: 'unknown',
					path: relPath,
					tags: normalizeTags(ymlModel?.config?.tags)
				});
			} catch {
				// skip
			}
		}
	}

	await walk(modelsDir);
	return models;
}

/**
 * Read the manifest and backfill column names into each model's `_models.yml`.
 * Only adds columns that aren't already documented — never overwrites existing
 * descriptions. Safe to call after every successful `dbt compile`.
 */
export async function backfillColumnsFromManifest(projectRoot: string): Promise<void> {
	assertAllowedProjectFolder(projectRoot);
	const manifestPath = path.join(projectRoot, 'target', 'manifest.json');
	let manifest: Manifest = {};
	try {
		manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Manifest;
	} catch {
		return;
	}

	const modelPaths = await readModelPaths(projectRoot);

	for (const [, node] of Object.entries(manifest.nodes ?? {})) {
		if (node.resource_type !== 'model') continue;
		if (!node.path) continue;

		const columns = Object.values(node.columns ?? {});
		if (columns.length === 0) continue;

		// `node.path` is already root-relative for dbt-core but carries the model-path
		// prefix for dbt-fusion, so normalize before re-anchoring under the model root.
		const modelRelPath = path.join(modelPaths[0], stripModelPathPrefix(node.path, modelPaths));
		const ymlPath = findSchemaFile(projectRoot, modelRelPath);
		const schema = await readSchemaFile(ymlPath);

		const existingModel = schema.models.find((m) => m.name === node.name);
		const existingColNames = new Set((existingModel?.columns ?? []).map((c) => c.name));

		const newColumns = columns
			.filter((col) => !existingColNames.has(col.name))
			.map((col) => ({ name: col.name, description: col.description ?? '' }));

		if (newColumns.length > 0) {
			const updated = upsertModelEntry(schema, node.name, { columns: newColumns });
			await writeSchemaFile(ymlPath, updated);
		}
	}
}

const REF_RE = /\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;

function extractRefs(content: string): string[] {
	const refs: string[] = [];
	let match: RegExpExecArray | null;
	REF_RE.lastIndex = 0;
	while ((match = REF_RE.exec(content)) !== null) {
		refs.push(match[1]);
	}
	return [...new Set(refs)];
}
