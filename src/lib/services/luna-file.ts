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
	CellScheduleScope
} from '$lib/stores/notebook.svelte';
import type { ChartConfig, GUIPipelineStage, ResultViewMode } from '$lib/types/gui-pipeline';

const QUERY_OPEN_RE = /^\{%\s*query\s+([^%]*?)\s*%\}\s*$/;
const QUERY_CLOSE_RE = /^\{%\s*\/query\s*%\}\s*$/;
const MODEL_REF_RE = /^\{%\s*model\s+ref="([^"]*)"\s*\/%\}\s*$/;
const UDF_OPEN_RE = /^\{%\s*udf\s*%\}\s*$/;
const UDF_CLOSE_RE = /^\{%\s*\/udf\s*%\}\s*$/;
const PLOT_OPEN_RE = /^\{%\s*plot\s+([^%]*?)\s*%\}\s*$/;
const PLOT_CLOSE_RE = /^\{%\s*\/plot\s*%\}\s*$/;
const PYTHON_OPEN_RE = /^\{%\s*python\s+([^%]*?)\s*%\}\s*$/;
const PYTHON_CLOSE_RE = /^\{%\s*\/python\s*%\}\s*$/;
// Forces a markdown-cell boundary that would otherwise be invisible: between two
// adjacent markdown cells (which would silently merge into one prose blob), or
// in place of a markdown cell whose content is empty (which would otherwise be
// indistinguishable from ordinary blank-line spacing between blocks and vanish).
const CELL_BREAK_RE = /^<!--\s*lunapad:cell\s*-->\s*$/;
const CELL_BREAK = '<!--lunapad:cell-->';

const MATERIALIZE_MODES: CellMaterializationMode[] = ['table', 'view', 'incremental', 'ephemeral'];

export interface LunaQueryMeta {
	editMode?: CellEditMode;
	resultViewMode?: ResultViewMode;
	chartConfig?: ChartConfig | null;
	guiStages?: GUIPipelineStage[];
	display?: CellDisplay;
	stageResultsCollapsed?: boolean[];
	scheduleEnabled?: boolean;
	scheduleIntervalMinutes?: number;
	scheduleScope?: CellScheduleScope;
}

export interface LunaQueryEntry {
	kind: 'query';
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
	| { kind: 'markdown'; markdown: string }
	| LunaQueryEntry
	| { kind: 'modelRef'; ref: string }
	| { kind: 'udf'; udfBody: string }
	| { kind: 'plot'; name: string; code: string }
	| { kind: 'python'; name: string; code: string };

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

function decodeMeta(b64: string | undefined): LunaQueryMeta {
	if (!b64) return {};
	try {
		return JSON.parse(fromBase64(b64)) as LunaQueryMeta;
	} catch {
		return {};
	}
}

function encodeMeta(meta: LunaQueryMeta): string {
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

	function flushProse(): boolean {
		const text = prose.join('\n').replace(/^\n+|\n+$/g, '');
		prose = [];
		if (text.trim() === '') return false;
		entries.push({ kind: 'markdown', markdown: text });
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

		if (CELL_BREAK_RE.test(line)) {
			// If there was no real prose to flush, this break marker stands for an
			// explicit empty markdown cell in its own right — record it as such.
			if (!flushProse()) entries.push({ kind: 'markdown', markdown: '' });
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
			entries.push({ kind: 'plot', name: attrs.name ?? '', code: bodyLines.join('\n').trim() });
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
			entries.push({ kind: 'python', name: attrs.name ?? '', code: bodyLines.join('\n').trim() });
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
				meta: decodeMeta(attrs.meta),
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
	cellType: 'query' | 'markdown' | 'udf' | 'plot' | 'python';
	markdown: string;
	udfBody: string;
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
	guiStages: GUIPipelineStage[];
	display: CellDisplay;
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
		guiStages: cell.guiStages,
		display: cell.display,
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
		(meta.guiStages?.length ?? 0) > 1 ||
		meta.display !== 'full' ||
		(meta.stageResultsCollapsed?.length ?? 0) > 0 ||
		!!meta.scheduleEnabled
	);
}

function serializeQueryBlock(cell: SerializableCell): string {
	const attrs: string[] = [`name="${cell.outputName}"`, `lang="${cell.language}"`];
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
			blocks.push(cell.markdown.trim() === '' ? CELL_BREAK : cell.markdown.trim());
		} else if (cell.cellType === 'udf') {
			blocks.push(`{% udf %}\n${cell.udfBody.trim()}\n{% /udf %}`);
		} else if (cell.cellType === 'plot') {
			blocks.push(`{% plot name="${cell.outputName}" %}\n${cell.code.trim()}\n{% /plot %}`);
		} else if (cell.cellType === 'python') {
			blocks.push(`{% python name="${cell.outputName}" %}\n${cell.code.trim()}\n{% /python %}`);
		} else if (cell.promotedModelPath) {
			blocks.push(`{% model ref="${cell.outputName}" /%}`);
		} else {
			blocks.push(serializeQueryBlock(cell));
		}
	}
	return blocks.join('\n\n') + '\n';
}
