import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DbtSchemaColumn {
	name: string;
	description?: string;
	tests?: string[];
}

export interface DbtSchemaModelConfig {
	materialized?: string;
	schema?: string;
	tags?: string[];
}

export interface DbtSchemaModel {
	name: string;
	description?: string;
	config?: DbtSchemaModelConfig;
	columns?: DbtSchemaColumn[];
}

export interface DbtSchemaFile {
	version: number;
	models: DbtSchemaModel[];
}

// ── Minimal YAML parser for dbt schema files ─────────────────────────────────
//
// Handles the subset of YAML that dbt _models.yml files use:
//   version: 2
//   models:
//     - name: ...
//       description: "..."
//       config:
//         materialized: table
//         schema: staging
//         tags: [a, b]
//       columns:
//         - name: col
//           description: "..."
//           tests:
//             - not_null
//             - unique

function parseYamlValue(raw: string): string | number | boolean | string[] {
	const trimmed = raw.trim();

	// Inline array: [a, b, c]
	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
		const inner = trimmed.slice(1, -1);
		return inner
			.split(',')
			.map((s) => unquote(s.trim()))
			.filter(Boolean);
	}

	// Quoted string
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	// Boolean
	if (trimmed === 'true') return true;
	if (trimmed === 'false') return false;

	// Number
	const num = Number(trimmed);
	if (!isNaN(num) && trimmed !== '') return num;

	return trimmed;
}

function unquote(s: string): string {
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

export function parseSchemaYaml(content: string): DbtSchemaFile {
	const lines = content.split('\n');
	const result: DbtSchemaFile = { version: 2, models: [] };

	let i = 0;

	function indent(line: string): number {
		let n = 0;
		while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
		return n;
	}

	function parseKey(line: string): { key: string; value: string } | null {
		const stripped = line.trim();
		if (stripped.startsWith('#') || stripped === '') return null;
		if (stripped.startsWith('- ')) {
			// list item with key
			const rest = stripped.slice(2);
			const colon = rest.indexOf(':');
			if (colon === -1) return { key: '-', value: unquote(rest.trim()) };
			return { key: rest.slice(0, colon).trim(), value: rest.slice(colon + 1).trim() };
		}
		const colon = stripped.indexOf(':');
		if (colon === -1) return null;
		return { key: stripped.slice(0, colon).trim(), value: stripped.slice(colon + 1).trim() };
	}

	// Parse top-level fields
	while (i < lines.length) {
		const line = lines[i];
		const stripped = line.trim();

		if (!stripped || stripped.startsWith('#')) {
			i++;
			continue;
		}

		const kv = parseKey(line);
		if (!kv) {
			i++;
			continue;
		}

		if (kv.key === 'version') {
			result.version = Number(kv.value) || 2;
			i++;
			continue;
		}

		if (kv.key === 'models' && kv.value === '') {
			// Parse models list
			i++;
			while (i < lines.length) {
				const mline = lines[i];
				if (!mline.trim() || mline.trim().startsWith('#')) {
					i++;
					continue;
				}
				if (indent(mline) === 0) break; // back to top level
				if (!mline.trim().startsWith('-')) {
					i++;
					continue;
				}

				const model: DbtSchemaModel = { name: '' };
				const modelIndent = indent(mline);

				// First line of list item
				const firstKv = parseKey(mline);
				if (firstKv && firstKv.key !== '-') {
					if (firstKv.key === 'name') model.name = unquote(firstKv.value);
				}
				i++;

				// Remaining fields of this model
				while (i < lines.length) {
					const fl = lines[i];
					if (!fl.trim() || fl.trim().startsWith('#')) {
						i++;
						continue;
					}
					const fi = indent(fl);
					if (fi <= modelIndent && fl.trim().startsWith('-')) break; // next model
					if (fi === 0) break; // back to top level
					const fkv = parseKey(fl);
					if (!fkv) {
						i++;
						continue;
					}

					if (fkv.key === 'name') {
						model.name = unquote(fkv.value);
						i++;
					} else if (fkv.key === 'description') {
						model.description = unquote(fkv.value);
						i++;
					} else if (fkv.key === 'config' && fkv.value === '') {
						const config: DbtSchemaModelConfig = {};
						const configIndent = fi;
						i++;
						while (i < lines.length) {
							const cl = lines[i];
							if (!cl.trim() || cl.trim().startsWith('#')) {
								i++;
								continue;
							}
							if (indent(cl) <= configIndent) break;
							const ckv = parseKey(cl);
							if (!ckv) {
								i++;
								continue;
							}
							if (ckv.key === 'materialized') {
								config.materialized = unquote(ckv.value);
							} else if (ckv.key === 'schema') {
								config.schema = unquote(ckv.value);
							} else if (ckv.key === 'tags') {
								const v = parseYamlValue(ckv.value);
								if (Array.isArray(v)) config.tags = v;
								else if (v !== '') config.tags = [String(v)];
								else {
									// block sequence of tags
									const tagIndent = indent(cl);
									i++;
									const tags: string[] = [];
									while (i < lines.length) {
										const tl = lines[i];
										if (!tl.trim() || tl.trim().startsWith('#')) {
											i++;
											continue;
										}
										if (indent(tl) <= tagIndent) break;
										if (tl.trim().startsWith('-')) {
											tags.push(unquote(tl.trim().slice(1).trim()));
										}
										i++;
									}
									config.tags = tags;
									continue;
								}
							}
							i++;
						}
						model.config = config;
					} else if (fkv.key === 'columns' && fkv.value === '') {
						const columns: DbtSchemaColumn[] = [];
						const columnsIndent = fi;
						i++;
						while (i < lines.length) {
							const cl = lines[i];
							if (!cl.trim() || cl.trim().startsWith('#')) {
								i++;
								continue;
							}
							if (indent(cl) <= columnsIndent && !cl.trim().startsWith('-')) break;
							if (indent(cl) <= columnsIndent && !cl.trim().startsWith('- name')) break;

							if (!cl.trim().startsWith('-')) {
								i++;
								continue;
							}

							const col: DbtSchemaColumn = { name: '' };
							const colIndent = indent(cl);
							const firstColKv = parseKey(cl);
							if (firstColKv && firstColKv.key === 'name') {
								col.name = unquote(firstColKv.value);
							}
							i++;

							while (i < lines.length) {
								const cfl = lines[i];
								if (!cfl.trim() || cfl.trim().startsWith('#')) {
									i++;
									continue;
								}
								const cfi = indent(cfl);
								if (cfi <= colIndent && cfl.trim().startsWith('-')) break;
								if (cfi <= columnsIndent) break;
								const cfkv = parseKey(cfl);
								if (!cfkv) {
									i++;
									continue;
								}
								if (cfkv.key === 'name') {
									col.name = unquote(cfkv.value);
									i++;
								} else if (cfkv.key === 'description') {
									col.description = unquote(cfkv.value);
									i++;
								} else if (cfkv.key === 'tests') {
									const v = parseYamlValue(cfkv.value);
									if (Array.isArray(v)) {
										col.tests = v;
										i++;
									} else {
										// block sequence
										const testIndent = indent(cfl);
										i++;
										const tests: string[] = [];
										while (i < lines.length) {
											const tl = lines[i];
											if (!tl.trim() || tl.trim().startsWith('#')) {
												i++;
												continue;
											}
											if (indent(tl) <= testIndent) break;
											if (tl.trim().startsWith('-')) {
												tests.push(unquote(tl.trim().slice(1).trim()));
											}
											i++;
										}
										col.tests = tests;
									}
								} else {
									i++;
								}
							}
							columns.push(col);
						}
						model.columns = columns;
					} else {
						i++;
					}
				}

				if (model.name) result.models.push(model);
			}
			continue;
		}

		i++;
	}

	return result;
}

// ── YAML serializer ──────────────────────────────────────────────────────────

function yamlString(s: string): string {
	// Quote if contains special chars, otherwise bare
	if (/[:#\[\]{}&*!,|>'"%@`]/.test(s) || s.includes('\n') || s.trim() !== s || s === '') {
		return `"${s.replace(/"/g, '\\"')}"`;
	}
	return s;
}

export function serializeSchemaYaml(schema: DbtSchemaFile): string {
	const lines: string[] = [`version: ${schema.version}`, '', 'models:'];

	if (schema.models.length === 0) {
		lines.push('  []');
	} else {
		for (const model of schema.models) {
			lines.push(`  - name: ${yamlString(model.name)}`);
			if (model.description !== undefined) {
				lines.push(`    description: ${yamlString(model.description)}`);
			}
			if (model.config) {
				lines.push('    config:');
				if (model.config.materialized) {
					lines.push(`      materialized: ${model.config.materialized}`);
				}
				if (model.config.schema) {
					lines.push(`      schema: ${model.config.schema}`);
				}
				if (model.config.tags && model.config.tags.length > 0) {
					lines.push(`      tags: [${model.config.tags.map(yamlString).join(', ')}]`);
				}
			}
			if (model.columns && model.columns.length > 0) {
				lines.push('    columns:');
				for (const col of model.columns) {
					lines.push(`      - name: ${yamlString(col.name)}`);
					if (col.description !== undefined) {
						lines.push(`        description: ${yamlString(col.description)}`);
					}
					if (col.tests && col.tests.length > 0) {
						lines.push('        tests:');
						for (const t of col.tests) {
							lines.push(`          - ${t}`);
						}
					}
				}
			}
		}
	}

	lines.push('');
	return lines.join('\n');
}

// ── File I/O helpers ─────────────────────────────────────────────────────────

/** Returns the path to `_models.yml` in the same directory as the given model file. */
export function findSchemaFile(projectRoot: string, modelRelPath: string): string {
	const dir = path.dirname(path.join(projectRoot, modelRelPath));
	return path.join(dir, '_models.yml');
}

export async function readSchemaFile(ymlPath: string): Promise<DbtSchemaFile> {
	try {
		const content = await fs.readFile(ymlPath, 'utf-8');
		return parseSchemaYaml(content);
	} catch {
		return { version: 2, models: [] };
	}
}

export async function writeSchemaFile(ymlPath: string, schema: DbtSchemaFile): Promise<void> {
	await fs.mkdir(path.dirname(ymlPath), { recursive: true });
	await fs.writeFile(ymlPath, serializeSchemaYaml(schema), 'utf-8');
}

export function upsertModelEntry(
	schema: DbtSchemaFile,
	name: string,
	updates: {
		description?: string | null;
		columns?: { name: string; description?: string; tests?: string[] }[];
		config?: DbtSchemaModelConfig;
	}
): DbtSchemaFile {
	const models = [...schema.models];
	let idx = models.findIndex((m) => m.name === name);
	if (idx === -1) {
		models.push({ name });
		idx = models.length - 1;
	}
	const model = { ...models[idx] };

	if (updates.description !== undefined) {
		model.description = updates.description ?? undefined;
	}

	if (updates.config) {
		const existing = model.config ?? {};
		model.config = { ...existing, ...updates.config };
		// Remove nullish values
		if (!model.config.materialized) delete model.config.materialized;
		if (!model.config.schema) delete model.config.schema;
		if (!model.config.tags?.length) delete model.config.tags;
		if (!Object.keys(model.config).length) delete model.config;
	}

	if (updates.columns) {
		const existing = model.columns ?? [];
		const merged = [...existing];
		for (const upd of updates.columns) {
			const ci = merged.findIndex((c) => c.name === upd.name);
			if (ci === -1) {
				merged.push({ name: upd.name, description: upd.description, tests: upd.tests });
			} else {
				merged[ci] = { ...merged[ci], ...upd };
			}
		}
		model.columns = merged;
	}

	models[idx] = model;
	return { ...schema, models };
}

export function removeModelEntry(schema: DbtSchemaFile, name: string): DbtSchemaFile {
	return { ...schema, models: schema.models.filter((m) => m.name !== name) };
}

/**
 * Rename a model entry in-place within a schema file, preserving all other
 * fields (description, config, columns). If the old name isn't found this is
 * a no-op. If the new name already exists the duplicate is removed first.
 */
export function renameModelEntry(
	schema: DbtSchemaFile,
	oldName: string,
	newName: string
): DbtSchemaFile {
	const entry = schema.models.find((m) => m.name === oldName);
	if (!entry) return schema;
	// Remove old entry + any pre-existing entry with the new name, then re-add renamed
	const models = schema.models
		.filter((m) => m.name !== oldName && m.name !== newName)
		.concat({ ...entry, name: newName });
	return { ...schema, models };
}

export async function updateModelSchema(
	projectRoot: string,
	modelRelPath: string,
	updates: {
		description?: string | null;
		columns?: { name: string; description?: string; tests?: string[] }[];
		config?: DbtSchemaModelConfig;
	}
): Promise<void> {
	const ymlPath = findSchemaFile(projectRoot, modelRelPath);
	const schema = await readSchemaFile(ymlPath);
	const modelName = path.basename(modelRelPath, path.extname(modelRelPath));
	const updated = upsertModelEntry(schema, modelName, updates);
	await writeSchemaFile(ymlPath, updated);
}
