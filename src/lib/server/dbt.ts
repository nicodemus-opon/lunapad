import fs from 'node:fs/promises';
import path from 'node:path';
import { readSchemaFile, findSchemaFile, upsertModelEntry, writeSchemaFile } from './dbt-schema.js';

export interface DbtModel {
	name: string;
	schema: string;
	description: string | null;
	columns: { name: string; dataType: string; description: string | null; tests: string[] }[];
	upstreamRefs: string[];
	materialized: 'table' | 'view' | 'incremental' | 'ephemeral';
	lastRunStatus: 'pass' | 'error' | 'unknown';
	path: string; // relative path within models/
}

interface ManifestNode {
	name: string;
	schema: string;
	description?: string;
	config?: { materialized?: string };
	columns?: Record<string, { name: string; data_type?: string; description?: string }>;
	depends_on?: { nodes?: string[] };
	path?: string;
	resource_type?: string;
}

interface Manifest {
	nodes?: Record<string, ManifestNode>;
}

interface RunResults {
	results?: Array<{ unique_id: string; status: string }>;
}

// ── Manifest parsing ─────────────────────────────────────────────────────────

export async function loadManifest(projectRoot: string): Promise<DbtModel[]> {
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

	// Build run status map
	const statusMap = new Map<string, 'pass' | 'error'>();
	for (const result of runResults.results ?? []) {
		statusMap.set(result.unique_id, result.status === 'success' ? 'pass' : 'error');
	}

	const models: DbtModel[] = [];
	for (const [nodeId, node] of Object.entries(manifest.nodes ?? {})) {
		if (node.resource_type !== 'model') continue;

		const upstreamRefs: string[] = [];
		for (const dep of node.depends_on?.nodes ?? []) {
			// dep is like "model.project_name.orders_clean"
			const parts = dep.split('.');
			if (parts[0] === 'model' && parts.length === 3) {
				upstreamRefs.push(parts[2]);
			}
		}

		const columns = Object.values(node.columns ?? {}).map((col) => ({
			name: col.name,
			dataType: col.data_type ?? 'unknown',
			description: col.description ?? null,
			tests: []
		}));

		models.push({
			name: node.name,
			schema: node.schema ?? '',
			description: node.description ?? null,
			columns,
			upstreamRefs,
			materialized: (node.config?.materialized ?? 'view') as DbtModel['materialized'],
			lastRunStatus: statusMap.get(nodeId) ?? 'unknown',
			path: node.path ?? ''
		});
	}

	return models;
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
					path: relPath
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
	const manifestPath = path.join(projectRoot, 'target', 'manifest.json');
	let manifest: Manifest = {};
	try {
		manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Manifest;
	} catch {
		return;
	}

	for (const [, node] of Object.entries(manifest.nodes ?? {})) {
		if (node.resource_type !== 'model') continue;
		if (!node.path) continue;

		const columns = Object.values(node.columns ?? {});
		if (columns.length === 0) continue;

		const modelRelPath = path.join('models', node.path);
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

const REF_RE = /\{\{\s*ref\('([^']+)'\)\s*\}\}/g;

function extractRefs(content: string): string[] {
	const refs: string[] = [];
	let match: RegExpExecArray | null;
	REF_RE.lastIndex = 0;
	while ((match = REF_RE.exec(content)) !== null) {
		refs.push(match[1]);
	}
	return [...new Set(refs)];
}
