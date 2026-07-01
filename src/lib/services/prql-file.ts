/**
 * Serialization / deserialization for the per-cell `.prql` file format.
 *
 * Each file stores exactly one cell. Metadata lives in `-- @key value` comment
 * headers at the top of the file; the PRQL (or markdown) content follows.
 *
 * Example (query cell):
 *   -- @type query
 *   -- @connection builtin.duckdb
 *   -- @materialized table
 *   -- @json {"editMode":"prql","resultViewMode":"chart","chartConfig":{...}}
 *   from {{ ref('orders_clean') }}
 *   filter amount > 100
 *
 * Example (markdown cell):
 *   -- @type markdown
 *   # My Analysis
 *
 * Cross-model references: `{{ ref('name') }}` in the file is transparently
 * stripped to the bare name when loading into the editor, and re-inserted when
 * saving. In-memory cell code always uses plain PRQL identifiers.
 */

import type {
	Cell,
	CellDisplay,
	CellEditMode,
	CellLanguage,
	CellMaterializationMode,
	CellScheduleScope,
	CellType
} from '$lib/stores/notebook.svelte';
import type { ResultViewMode, ChartConfig } from '$lib/types/gui-pipeline';
import type { GUIPipelineStage } from '$lib/types/gui-pipeline';

// ── Ref stripping / injection ────────────────────────────────────────────────

const REF_RE = /\{\{\s*ref\('([^']+)'\)\s*\}\}/g;

/** Strip `{{ ref('name') }}` → bare name for in-editor display. */
export function stripRefs(code: string): string {
	return code.replace(REF_RE, '$1');
}

/** Insert `{{ ref('name') }}` for each word-boundary match of a known model name.
 *  Does NOT inject when the name is schema-qualified (preceded by a dot). */
export function injectRefs(code: string, knownModels: string[]): string {
	if (knownModels.length === 0) return code;
	let result = code;
	for (const name of knownModels) {
		// (?<!\.) — not after a dot (schema-qualified)
		// (?<!ref\(') — not already wrapped in ref()
		// (?!'\)) — not already closing a ref()
		const re = new RegExp(`(?<!\\.)(?<!ref\\(')\\b${escapeRegExp(name)}\\b(?!'\\))`, 'g');
		result = result.replace(re, `{{ ref('${name}') }}`);
	}
	return result;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── JSON metadata block ──────────────────────────────────────────────────────

interface CellJsonMeta {
	language?: CellLanguage;
	editMode?: CellEditMode;
	resultViewMode?: ResultViewMode;
	chartConfig?: ChartConfig | null;
	guiStages?: GUIPipelineStage[];
	display?: CellDisplay;
	hideResult?: boolean;
	/** Legacy pre-display field; still read from old files, never written. */
	collapsed?: boolean;
	stageResultsCollapsed?: boolean[];
	scheduleEnabled?: boolean;
	scheduleIntervalMinutes?: number;
	scheduleScope?: CellScheduleScope;
}

function buildJsonMeta(cell: Cell): CellJsonMeta {
	return {
		language: cell.language ?? 'prql',
		editMode: cell.editMode,
		resultViewMode: cell.resultViewMode,
		chartConfig: cell.resultChartConfig,
		guiStages: cell.guiStages,
		display: cell.display,
		hideResult: cell.hideResult,
		stageResultsCollapsed: cell.stageResultsCollapsed,
		scheduleEnabled: cell.scheduleEnabled,
		scheduleIntervalMinutes: cell.scheduleIntervalMinutes,
		scheduleScope: cell.scheduleScope
	};
}

// ── Serialize ────────────────────────────────────────────────────────────────

/**
 * Serialize a single cell to `.prql` file content.
 *
 * @param cell          The cell to serialize.
 * @param knownModels   Names of other dbt models in the project. Any word-
 *                      boundary matches in the cell's code are rewritten as
 *                      `{{ ref('name') }}` for dbt compatibility.
 * @param notebookId    When set, emits a `-- @notebook` header so the file-
 *                      watcher reload re-groups this cell under the correct
 *                      multi-cell notebook rather than creating a standalone one.
 */
export function serializeCell(cell: Cell, knownModels: string[] = [], notebookId?: string): string {
	const lines: string[] = [];

	// Notebook annotation for secondary cells in multi-cell filesystem notebooks
	if (notebookId) {
		lines.push(`-- @notebook ${notebookId}`);
	}

	// Type header (only emit for markdown; query is the default)
	if (cell.cellType === 'markdown') {
		lines.push('-- @type markdown');
	}

	if (cell.cellType === 'query') {
		// Connection (omit for built-in DuckDB since it's the default)
		if (cell.connectionId) {
			lines.push(`-- @connection ${cell.connectionId}`);
		}

		// Materialization (omit default 'table')
		if (cell.materializeMode && cell.materializeMode !== 'table') {
			lines.push(`-- @materialized ${cell.materializeMode}`);
		}

		// dbt schema override
		if (cell.dbtSchema) {
			lines.push(`-- @schema ${cell.dbtSchema}`);
		}

		// dbt tags
		if (cell.dbtTags && cell.dbtTags.length > 0) {
			lines.push(`-- @tags ${cell.dbtTags.join(',')}`);
		}

		// JSON metadata (only emit if there's something non-default)
		const meta = buildJsonMeta(cell);
		const hasNonDefault =
			meta.language === 'sql' ||
			meta.editMode !== 'gui' ||
			meta.resultViewMode !== 'table' ||
			meta.chartConfig !== null ||
			(meta.guiStages && meta.guiStages.length > 0) ||
			meta.display !== 'full' ||
			!!meta.hideResult ||
			(meta.stageResultsCollapsed && meta.stageResultsCollapsed.length > 0) ||
			meta.scheduleEnabled;

		if (hasNonDefault) {
			lines.push(`-- @json ${JSON.stringify(meta)}`);
		}
	}

	// Blank separator between headers and content (if there were any headers)
	if (lines.length > 0) {
		lines.push('');
	}

	// Content: inject refs for query cells, plain text for markdown
	const content =
		cell.cellType === 'markdown' ? cell.markdown : injectRefs(cell.code.trim(), knownModels);

	lines.push(content);

	return lines.join('\n');
}

// ── Deserialize ──────────────────────────────────────────────────────────────

/**
 * Parse `.prql` file content into the fields needed to reconstruct a Cell.
 * The caller is responsible for merging these fields into a `makeCell()` base
 * using the same normalization as `deserializeCell` in the store.
 */
export interface ParsedCellFile {
	cellType: CellType;
	language: CellLanguage;
	connectionId: string | null;
	materializeMode: CellMaterializationMode;
	dbtSchema: string | null;
	dbtTags: string[];
	meta: CellJsonMeta;
	/** In-memory code ({{ ref() }} already stripped for PRQL; raw SQL for SQL cells). */
	code: string;
	/** Markdown content (for markdown cells). */
	markdown: string;
	/**
	 * When set, this file is a secondary cell of a multi-cell notebook.
	 * The value is the notebook ID (e.g. `models/staging/stg_orders`).
	 */
	notebookId: string | null;
}

/**
 * @param content       Raw file content.
 * @param fileLanguage  Language inferred from the file extension: 'sql' for .sql files,
 *                      'prql' (default) for .prql files. The @json language field takes
 *                      precedence when present.
 */
export function parseCellFile(
	content: string,
	fileLanguage: CellLanguage = 'prql'
): ParsedCellFile {
	const lines = content.split('\n');
	let cellType: CellType = 'query';
	let connectionId: string | null = null;
	let materializeMode: CellMaterializationMode = 'table';
	let dbtSchema: string | null = null;
	let dbtTags: string[] = [];
	let meta: CellJsonMeta = {};
	let notebookId: string | null = null;
	let contentStart = 0;

	// Parse `-- @key value` headers from the top of the file
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (!line.startsWith('-- @')) {
			// Skip a single blank separator line between headers and content
			if (line.trim() === '' && i > 0 && lines[i - 1].startsWith('-- @')) {
				contentStart = i + 1;
			} else {
				contentStart = i;
			}
			break;
		}

		const spaceIdx = line.indexOf(' ', 4); // after '-- @'
		const key = spaceIdx === -1 ? line.slice(4) : line.slice(4, spaceIdx);
		const value = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);

		switch (key) {
			case 'notebook':
				notebookId = value || null;
				break;
			case 'type':
				cellType = value === 'markdown' ? 'markdown' : 'query';
				break;
			case 'connection':
				connectionId = value || null;
				break;
			case 'materialized':
				materializeMode = (
					['table', 'view', 'incremental', 'ephemeral'] as CellMaterializationMode[]
				).includes(value as CellMaterializationMode)
					? (value as CellMaterializationMode)
					: 'table';
				break;
			case 'schema':
				dbtSchema = value || null;
				break;
			case 'tags':
				dbtTags = value
					? value
							.split(',')
							.map((t) => t.trim())
							.filter(Boolean)
					: [];
				break;
			case 'json':
				try {
					meta = JSON.parse(value) as CellJsonMeta;
				} catch {
					// ignore malformed JSON
				}
				break;
		}

		contentStart = i + 1;
	}

	const rawContent = lines.slice(contentStart).join('\n').trimEnd();

	// Language: @json field wins over file extension hint
	const language: CellLanguage =
		meta.language === 'sql' || (meta.language !== 'prql' && fileLanguage === 'sql')
			? 'sql'
			: 'prql';

	if (cellType === 'markdown') {
		return {
			cellType,
			language,
			connectionId,
			materializeMode,
			dbtSchema,
			dbtTags,
			meta,
			code: '',
			markdown: rawContent,
			notebookId
		};
	}

	let code: string;
	if (language === 'sql') {
		// Strip dbt Jinja so the in-memory code is valid SQL for editing and execution.
		// Extract metadata from {{ config() }} before stripping (headers win when present).
		const configMatch = rawContent.match(/\{\{-?\s*config\(([\s\S]*?)\)\s*-?\}\}/);
		if (configMatch) {
			const cfg = configMatch[1];
			if (materializeMode === 'table') {
				const m = cfg.match(/materialized\s*=\s*['"](\w+)['"]/);
				if (m && ['table', 'view', 'incremental', 'ephemeral'].includes(m[1])) {
					materializeMode = m[1] as CellMaterializationMode;
				}
			}
			if (!dbtSchema) {
				const s = cfg.match(/schema\s*=\s*['"]([^'"]+)['"]/);
				if (s) dbtSchema = s[1];
			}
			if (dbtTags.length === 0) {
				const t = cfg.match(/tags\s*=\s*\[([^\]]*)\]/);
				if (t)
					dbtTags = t[1]
						.split(',')
						.map((x) => x.trim().replace(/['"]/g, ''))
						.filter(Boolean);
			}
		}
		code = rawContent
			.replace(/\{\{-?\s*config\([\s\S]*?\)\s*-?\}\}\s*/g, '')
			.replace(REF_RE, '$1')
			.trim();
	} else {
		// PRQL cells: strip {{ ref() }} for in-editor display
		code = stripRefs(rawContent);
	}

	return {
		cellType,
		language,
		connectionId,
		materializeMode,
		dbtSchema,
		dbtTags,
		meta,
		code,
		markdown: '',
		notebookId
	};
}
