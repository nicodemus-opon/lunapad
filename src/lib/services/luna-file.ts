/**
 * Serialization / deserialization for the `.luna` multi-cell notebook file format.
 *
 * A `.luna` file is one notebook: markdown prose and query cells interleaved in
 * document order (cell order = position in the file, no separate index needed).
 *
 * Example:
 *   # Some notebook
 *
 *   Prose here, rendered via the existing markdoc-interp.ts pipeline.
 *
 *   {% query name="stg_orders" lang="prql" connection="builtin.duckdb" %}
 *   from orders
 *   filter status == "completed"
 *   {% /query %}
 *
 *   {% model ref="stg_customers" /%}
 *
 * IMPORTANT: this format is NOT parsed via Markdoc.parse(). A query cell's raw
 * source can legitimately contain the literal substring `{%` (a SQL comment, a
 * string literal, dbt's own `{{ ref() }}` jinja, etc.) and Markdoc's tokenizer
 * scans for `{%`/`%}` everywhere — including inside fenced code blocks — with
 * no working escape sequence. Handing raw cell code to Markdoc would corrupt
 * the document. Instead this module does its own line-oriented boundary scan
 * for `{% query ... %}` / `{% /query %}` / `{% model ref="..." /%}` markers
 * (which Lunapad fully controls, both on write and on read) and treats
 * everything else as opaque markdown prose — the same prose that already goes
 * through the existing `renderMarkdocCell` pipeline for markdown-type cells,
 * unchanged.
 */

import type {
	CellDisplay,
	CellEditMode,
	CellLanguage,
	CellMaterializationMode,
	CellType,
	CellScheduleScope
} from '$lib/stores/notebook.svelte';
import type { ChartConfig, GUIPipelineStage, ResultViewMode } from '$lib/types/gui-pipeline';
import type { ColumnConditionalRules } from '$lib/services/report-table-conditional-format';
import type { ControlCellConfig } from '$lib/services/control-cells';

const QUERY_OPEN_RE = /^\{%\s*query\s+([^%]*?)\s*%\}\s*$/;
const QUERY_CLOSE_RE = /^\{%\s*\/query\s*%\}\s*$/;
const MODEL_REF_RE = /^\{%\s*model\s+ref="([^"]*)"\s*\/%\}\s*$/;
const UDF_OPEN_RE = /^\{%\s*udf\s*%\}\s*$/;
const UDF_CLOSE_RE = /^\{%\s*\/udf\s*%\}\s*$/;
const PLOT_OPEN_RE = /^\{%\s*plot\s+([^%]*?)\s*%\}\s*$/;
const PLOT_CLOSE_RE = /^\{%\s*\/plot\s*%\}\s*$/;
const PYTHON_OPEN_RE = /^\{%\s*python\s+([^%]*?)\s*%\}\s*$/;
const PYTHON_CLOSE_RE = /^\{%\s*\/python\s*%\}\s*$/;
const CONTROL_RE = /^\{%\s*control\s+([^%]*?)\s*\/%\}\s*$/;
// Forces a markdown-cell boundary that would otherwise be invisible: between two
// adjacent markdown cells (which would silently merge into one prose blob), or
// in place of a markdown cell whose content is empty (which would otherwise be
// indistinguishable from ordinary blank-line spacing between blocks and vanish).
const CELL_BREAK_RE = /^<!--\s*lunapad:cell\s*-->\s*$/;
const CELL_BREAK = '<!--lunapad:cell-->';
// Persists a markdown cell's editor mode (Visual dashboard builder vs raw Markdoc
// source). Emitted only for `source` — `visual` is the default, so unmarked prose loads
// in the visual editor and pre-existing files stay backward-compatible. The marker
// applies to the markdown cell that immediately follows it.
const MD_MODE_RE = /^<!--\s*lunapad:md\s+(visual|source)\s*-->\s*$/;
const mdModeMarker = (mode: 'visual' | 'source') => `<!--lunapad:md ${mode}-->`;

const MATERIALIZE_MODES: CellMaterializationMode[] = ['table', 'view', 'incremental', 'ephemeral'];

export interface LunaQueryMeta {
	editMode?: CellEditMode;
	resultViewMode?: ResultViewMode;
	chartConfig?: ChartConfig | null;
	columnFormatRules?: ColumnConditionalRules;
	columnWidths?: Record<string, number>;
	guiStages?: GUIPipelineStage[];
	display?: CellDisplay;
	hideResult?: boolean;
	hideInReport?: boolean;
	stageResultsCollapsed?: boolean[];
	scheduleEnabled?: boolean;
	scheduleIntervalMinutes?: number;
	scheduleScope?: CellScheduleScope;
}

export interface LunaPlotMeta {
	plotMode?: 'gui' | 'code';
	plotConfig?: ChartConfig | null;
	/** Source cell referenced by outputName, not id — ids aren't stable across
	 *  reloads/reparse the way outputNames are, so this is resolved back to an
	 *  id post-hydration (see hydrateLunaEntries in server/project.ts). */
	plotSourceCellName?: string | null;
}

export interface LunaQueryEntry {
	kind: 'query';
	cellId?: string;
	name: string;
	lang: CellLanguage;
	connection: string | null;
	materialized: CellMaterializationMode;
	schema: string | null;
	tags: string[];
	meta: LunaQueryMeta;
	code: string;
}

export type LunaEntry =
	| { kind: 'markdown'; markdown: string; editMode?: 'visual' | 'source' }
	| LunaQueryEntry
	| { kind: 'modelRef'; ref: string }
	| { kind: 'udf'; udfBody: string }
	| { kind: 'plot'; cellId?: string; name: string; code: string; meta?: LunaPlotMeta }
	| { kind: 'python'; cellId?: string; name: string; code: string }
	| {
			kind: 'control';
			cellId?: string;
			name: string;
			cellType: CellType;
			config: ControlCellConfig;
	  };

export interface LunaDocument {
	entries: LunaEntry[];
}

// ── UTF-8-safe base64 (isomorphic: works in browser and Node, unlike Buffer) ──

function toBase64(s: string): string {
	const utf8 = encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, hex) =>
		String.fromCharCode(parseInt(hex, 16))
	);
	return btoa(utf8);
}

function fromBase64(b64: string): string {
	const utf8 = atob(b64);
	return decodeURIComponent(
		utf8
			.split('')
			.map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
			.join('')
	);
}

function decodeMeta<T>(b64: string | undefined): T | undefined {
	if (!b64) return undefined;
	try {
		return JSON.parse(fromBase64(b64)) as T;
	} catch {
		return undefined;
	}
}

function encodeMeta(meta: object): string {
	return toBase64(JSON.stringify(meta));
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /(\w+)="([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw))) attrs[m[1]] = m[2];
	return attrs;
}

// ── Parse ────────────────────────────────────────────────────────────────────

export function parseLunaFile(content: string): LunaDocument {
	const lines = content.split('\n');
	const entries: LunaEntry[] = [];
	let prose: string[] = [];
	// Set by a `<!--lunapad:md source-->` marker; consumed by the next markdown entry.
	let pendingMdMode: 'visual' | 'source' | undefined;

	function takeMdMode(): { editMode?: 'visual' | 'source' } {
		const mode = pendingMdMode;
		pendingMdMode = undefined;
		return mode ? { editMode: mode } : {};
	}

	function flushProse(): boolean {
		const text = prose.join('\n').replace(/^\n+|\n+$/g, '');
		prose = [];
		if (text.trim() === '') return false;
		entries.push({ kind: 'markdown', markdown: text, ...takeMdMode() });
		return true;
	}

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const openMatch = line.match(QUERY_OPEN_RE);
		const modelMatch = line.match(MODEL_REF_RE);
		const udfOpenMatch = line.match(UDF_OPEN_RE);
		const plotOpenMatch = line.match(PLOT_OPEN_RE);
		const pythonOpenMatch = line.match(PYTHON_OPEN_RE);
		const controlMatch = line.match(CONTROL_RE);

		const mdModeMatch = line.match(MD_MODE_RE);
		if (mdModeMatch) {
			// Flush any prose belonging to the previous cell first, then arm the mode for
			// the markdown cell that follows this marker.
			flushProse();
			pendingMdMode = mdModeMatch[1] as 'visual' | 'source';
			i++;
			continue;
		}

		if (CELL_BREAK_RE.test(line)) {
			// If there was no real prose to flush, this break marker stands for an
			// explicit empty markdown cell in its own right — record it as such.
			if (!flushProse()) entries.push({ kind: 'markdown', markdown: '', ...takeMdMode() });
			i++;
			continue;
		}

		if (udfOpenMatch) {
			flushProse();
			const bodyLines: string[] = [];
			i++;
			while (i < lines.length && !UDF_CLOSE_RE.test(lines[i])) {
				bodyLines.push(lines[i]);
				i++;
			}
			entries.push({ kind: 'udf', udfBody: bodyLines.join('\n').trim() });
			i++; // skip closing marker (no-op if body ran to EOF unterminated)
			continue;
		}

		if (plotOpenMatch) {
			flushProse();
			const attrs = parseAttrs(plotOpenMatch[1]);
			const bodyLines: string[] = [];
			i++;
			while (i < lines.length && !PLOT_CLOSE_RE.test(lines[i])) {
				bodyLines.push(lines[i]);
				i++;
			}
			entries.push({
				kind: 'plot',
				cellId: attrs.id,
				name: attrs.name ?? '',
				code: bodyLines.join('\n').trim(),
				meta: decodeMeta<LunaPlotMeta>(attrs.meta)
			});
			i++; // skip closing marker (no-op if body ran to EOF unterminated)
			continue;
		}

		if (pythonOpenMatch) {
			flushProse();
			const attrs = parseAttrs(pythonOpenMatch[1]);
			const bodyLines: string[] = [];
			i++;
			while (i < lines.length && !PYTHON_CLOSE_RE.test(lines[i])) {
				bodyLines.push(lines[i]);
				i++;
			}
			entries.push({
				kind: 'python',
				cellId: attrs.id,
				name: attrs.name ?? '',
				code: bodyLines.join('\n').trim()
			});
			i++; // skip closing marker (no-op if body ran to EOF unterminated)
			continue;
		}

		if (openMatch) {
			flushProse();
			const attrs = parseAttrs(openMatch[1]);
			const bodyLines: string[] = [];
			i++;
			while (i < lines.length && !QUERY_CLOSE_RE.test(lines[i])) {
				bodyLines.push(lines[i]);
				i++;
			}
			entries.push({
				kind: 'query',
				cellId: attrs.id,
				name: attrs.name ?? '',
				lang: attrs.lang === 'sql' ? 'sql' : 'prql',
				connection: attrs.connection ?? null,
				materialized: MATERIALIZE_MODES.includes(attrs.materialized as CellMaterializationMode)
					? (attrs.materialized as CellMaterializationMode)
					: 'table',
				schema: attrs.schema ?? null,
				tags: attrs.tags
					? attrs.tags
							.split(',')
							.map((t) => t.trim())
							.filter(Boolean)
					: [],
				meta: decodeMeta<LunaQueryMeta>(attrs.meta) ?? {},
				code: bodyLines.join('\n').trim()
			});
			i++; // skip closing marker (no-op if body ran to EOF unterminated)
			continue;
		}

		if (modelMatch) {
			flushProse();
			entries.push({ kind: 'modelRef', ref: modelMatch[1] });
			i++;
			continue;
		}

		if (controlMatch) {
			flushProse();
			const attrs = parseAttrs(controlMatch[1]);
			const config = decodeMeta<ControlCellConfig>(attrs.meta);
			if (config) {
				entries.push({
					kind: 'control',
					cellId: attrs.id,
					name: attrs.name ?? config.name ?? '',
					cellType: (attrs.cellType as CellType) || 'input',
					config
				});
			}
			i++;
			continue;
		}

		prose.push(line);
		i++;
	}

	flushProse();
	return { entries };
}

// ── Serialize ────────────────────────────────────────────────────────────────

/** Minimal shape needed to serialize one cell — kept separate from the store's
 *  `Cell` type so this module has no runtime dependency on notebook.svelte.ts. */
export interface SerializableCell {
	id: string;
	cellType: CellType;
	markdown: string;
	markdownEditMode?: 'visual' | 'source';
	udfBody: string;
	controlConfig: ControlCellConfig | null;
	outputName: string;
	language: CellLanguage;
	code: string;
	connectionId: string | null;
	materializeMode: CellMaterializationMode;
	dbtSchema: string | null;
	dbtTags: string[];
	editMode: CellEditMode;
	resultViewMode: ResultViewMode;
	resultChartConfig: ChartConfig | null;
	plotMode: 'gui' | 'code';
	plotConfig: ChartConfig | null;
	plotSourceCellId: string | null;
	columnFormatRules: ColumnConditionalRules;
	columnWidths: Record<string, number>;
	guiStages: GUIPipelineStage[];
	display: CellDisplay;
	hideResult: boolean;
	hideInReport: boolean;
	stageResultsCollapsed: boolean[];
	scheduleEnabled: boolean;
	scheduleIntervalMinutes: number;
	scheduleScope: CellScheduleScope;
	/** When set, this cell has been promoted to a real model file — serialize as a `{% model ref %}` placeholder. */
	promotedModelPath?: string | null;
}

function buildMeta(cell: SerializableCell): LunaQueryMeta {
	return {
		editMode: cell.editMode,
		resultViewMode: cell.resultViewMode,
		chartConfig: cell.resultChartConfig,
		columnFormatRules:
			cell.columnFormatRules && Object.keys(cell.columnFormatRules).length > 0
				? cell.columnFormatRules
				: undefined,
		columnWidths:
			cell.columnWidths && Object.keys(cell.columnWidths).length > 0
				? cell.columnWidths
				: undefined,
		guiStages: cell.guiStages,
		display: cell.display,
		hideResult: cell.hideResult,
		hideInReport: cell.hideInReport,
		stageResultsCollapsed: cell.stageResultsCollapsed,
		scheduleEnabled: cell.scheduleEnabled,
		scheduleIntervalMinutes: cell.scheduleIntervalMinutes,
		scheduleScope: cell.scheduleScope
	};
}

function hasNonDefaultMeta(meta: LunaQueryMeta, lang: CellLanguage): boolean {
	return (
		meta.editMode !== (lang === 'sql' ? 'prql' : 'gui') ||
		meta.resultViewMode !== 'table' ||
		!!meta.chartConfig ||
		(!!meta.columnFormatRules && Object.keys(meta.columnFormatRules).length > 0) ||
		(!!meta.columnWidths && Object.keys(meta.columnWidths).length > 0) ||
		(meta.guiStages?.length ?? 0) > 1 ||
		meta.display !== 'full' ||
		!!meta.hideResult ||
		!!meta.hideInReport ||
		(meta.stageResultsCollapsed?.length ?? 0) > 0 ||
		!!meta.scheduleEnabled
	);
}

function serializeQueryBlock(cell: SerializableCell): string {
	const attrs: string[] = [`name="${cell.outputName}"`, `lang="${cell.language}"`];
	if (cell.id && cell.id !== cell.outputName) attrs.push(`id="${cell.id}"`);
	if (cell.connectionId) attrs.push(`connection="${cell.connectionId}"`);
	if (cell.materializeMode && cell.materializeMode !== 'table')
		attrs.push(`materialized="${cell.materializeMode}"`);
	if (cell.dbtSchema) attrs.push(`schema="${cell.dbtSchema}"`);
	if (cell.dbtTags.length > 0) attrs.push(`tags="${cell.dbtTags.join(',')}"`);

	const meta = buildMeta(cell);
	if (hasNonDefaultMeta(meta, cell.language)) attrs.push(`meta="${encodeMeta(meta)}"`);

	return `{% query ${attrs.join(' ')} %}\n${cell.code.trim()}\n{% /query %}`;
}

/**
 * Replace a single `{% query name="X" %}...{% /query %}` block with a
 * `{% model ref="X" /%}` placeholder, leaving the rest of the file
 * byte-identical. Used after promoting a cell to a real model file. No-op if
 * no matching block is found.
 */
export function replaceCellWithModelRef(content: string, outputName: string): string {
	const lines = content.split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const openMatch = line.match(QUERY_OPEN_RE);
		if (openMatch && parseAttrs(openMatch[1]).name === outputName) {
			out.push(`{% model ref="${outputName}" /%}`);
			i++;
			while (i < lines.length && !QUERY_CLOSE_RE.test(lines[i])) i++;
			i++; // skip closing marker
			continue;
		}
		out.push(line);
		i++;
	}
	return out.join('\n');
}

export function serializeLunaFile(cells: SerializableCell[]): string {
	const blocks: string[] = [];
	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];
		if (cell.cellType === 'markdown') {
			// Two markdown cells back-to-back would otherwise merge into one prose
			// blob on the next parse — force a boundary between them.
			if (cells[i - 1]?.cellType === 'markdown') blocks.push(CELL_BREAK);
			const parts: string[] = [];
			// Persist a non-default (source) editor mode; visual stays implicit.
			if (cell.markdownEditMode === 'source') parts.push(mdModeMarker('source'));
			parts.push(cell.markdown.trim() === '' ? CELL_BREAK : cell.markdown.trim());
			blocks.push(parts.join('\n'));
		} else if (cell.cellType === 'udf') {
			blocks.push(`{% udf %}\n${cell.udfBody.trim()}\n{% /udf %}`);
		} else if (cell.cellType === 'plot') {
			const attrs = [`name="${cell.outputName}"`];
			if (cell.id && cell.id !== cell.outputName) attrs.push(`id="${cell.id}"`);
			if (cell.plotMode === 'gui' && cell.plotConfig) {
				const sourceName = cells.find((c) => c.id === cell.plotSourceCellId)?.outputName ?? null;
				const meta: LunaPlotMeta = {
					plotMode: 'gui',
					plotConfig: cell.plotConfig,
					plotSourceCellName: sourceName
				};
				attrs.push(`meta="${encodeMeta(meta)}"`);
			}
			blocks.push(`{% plot ${attrs.join(' ')} %}\n${cell.code.trim()}\n{% /plot %}`);
		} else if (cell.cellType === 'python') {
			const attrs = [`name="${cell.outputName}"`];
			if (cell.id && cell.id !== cell.outputName) attrs.push(`id="${cell.id}"`);
			blocks.push(`{% python ${attrs.join(' ')} %}\n${cell.code.trim()}\n{% /python %}`);
		} else if (cell.controlConfig) {
			const attrs = [
				`name="${cell.outputName}"`,
				`cellType="${cell.cellType}"`,
				`meta="${encodeMeta(cell.controlConfig)}"`
			];
			if (cell.id && cell.id !== cell.outputName) attrs.push(`id="${cell.id}"`);
			blocks.push(`{% control ${attrs.join(' ')} /%}`);
		} else if (cell.promotedModelPath) {
			blocks.push(`{% model ref="${cell.outputName}" /%}`);
		} else {
			blocks.push(serializeQueryBlock(cell));
		}
	}
	return blocks.join('\n\n') + '\n';
}
