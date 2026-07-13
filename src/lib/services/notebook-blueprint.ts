import type { CellLanguage, CellType } from '$lib/stores/notebook.svelte';
import {
	CHART_TYPES,
	FILTER_KINDS,
	PICTOGRAM_MAX_ICONS,
	type GeneratedDashboardBlock
} from './generated-dashboard';
import {
	getMarkdocPmSchema,
	markdownToPmDocument,
	normalizePmNodeIds,
	pmDocumentToMarkdown,
	tiptapNodeJsonToPm,
	type PMDocJSON,
	type PMNodeJSON
} from './markdoc-pm';
import { markdocAttrsToJson } from './markdoc-ast';
import { DASHBOARD_ICON_NAMES, isDashboardIconName } from './dashboard-icons';

export interface NotebookExecutableBlueprint {
	cellId: string;
	outputName: string;
	cellType?: Extract<CellType, 'query' | 'python' | 'plot'>;
	language?: CellLanguage;
	code: string;
}

export type NotebookBlueprintBlock =
	| GeneratedDashboardBlock
	| {
			type: 'queryBlock';
			cellId: string;
			cellType?: Extract<CellType, 'query' | 'python' | 'plot'>;
			pinned?: boolean;
	  };

export interface NotebookBlueprint {
	title?: string;
	executableCells?: NotebookExecutableBlueprint[];
	blocks: NotebookBlueprintBlock[];
}

export interface NotebookBlueprintDiagnostic {
	path: string;
	nodeType?: string;
	attribute?: string;
	invalidValue?: unknown;
	message: string;
}

export interface CompileNotebookBlueprintResult {
	document: PMDocJSON | null;
	executableCells: NotebookExecutableBlueprint[];
	diagnostics: NotebookBlueprintDiagnostic[];
}

export type NotebookPatchOperation =
	| { op: 'replace_document'; document: PMDocJSON }
	| { op: 'insert_node'; parentNodeId?: string; index?: number; node: PMNodeJSON }
	| { op: 'replace_node'; nodeId: string; node: PMNodeJSON }
	| { op: 'delete_node'; nodeId: string }
	| { op: 'patch_attrs'; nodeId: string; attrs: Record<string, unknown> }
	| { op: 'move_node'; nodeId: string; parentNodeId?: string; index: number };

export interface ApplyNotebookPatchResult {
	document: PMDocJSON | null;
	diagnostics: NotebookBlueprintDiagnostic[];
}

const CONTAINER_CHILD_RULES: Record<string, string> = {
	tabs: 'tab',
	columns: 'column'
};

function diagnostic(
	path: string,
	message: string,
	extra: Omit<NotebookBlueprintDiagnostic, 'path' | 'message'> = {}
): NotebookBlueprintDiagnostic {
	return { path, message, ...extra };
}

function paragraph(text = ''): PMNodeJSON {
	return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}

function textNodesFromMarkdown(markdown: string): PMNodeJSON[] {
	return markdownToPmDocument(markdown).doc.content ?? [paragraph(markdown)];
}

function widget(tagName: string, attrs: Record<string, unknown> = {}): PMNodeJSON {
	return {
		type: 'markdocWidget',
		attrs: {
			tagName,
			attrsJson: markdocAttrsToJson(attrs),
			selfClosing: true
		}
	};
}

function container(
	tagName: string,
	content: PMNodeJSON[],
	attrs: Record<string, unknown> = {}
): PMNodeJSON {
	return {
		type: 'markdocContainer',
		attrs: {
			tagName,
			attrsJson: markdocAttrsToJson(attrs)
		},
		content: content.length ? content : [paragraph()]
	};
}

function scalar(value: unknown): unknown {
	return value;
}

// `document`/`operations` payloads are raw, hand-constructed PM JSON straight from the model —
// unlike `blueprint`, nothing guarantees `content` is actually an array. `node.content ?? []`
// only substitutes when content is null/undefined, so a malformed non-array `content` (a string,
// object, etc.) sails through and crashes every tree walker below with "forEach is not a
// function" — an unhandled exception instead of a repairable diagnostic. Coerce defensively.
function contentArray(node: { content?: unknown } | undefined | null): PMNodeJSON[] {
	return Array.isArray(node?.content) ? (node!.content as PMNodeJSON[]) : [];
}

function validateKnownRef(
	value: unknown,
	knownRefs: Set<string>,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[]
): void {
	if (typeof value !== 'string') return;
	for (const match of value.matchAll(/\$([A-Za-z_]\w*)/g)) {
		const root = match[1];
		if (!knownRefs.has(root)) {
			diagnostics.push(
				diagnostic(path, `Unknown live reference "${root}".`, {
					attribute: 'ref',
					invalidValue: value
				})
			);
		}
	}
}

function attrsFromBlock(
	block: Record<string, unknown>,
	omit: string[] = ['type']
): Record<string, unknown> {
	const attrs: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(block)) {
		if (omit.includes(key) || value === undefined || value === null || value === '') continue;
		attrs[key] = value;
	}
	return attrs;
}

// Same malformed-input risk as compileChildren below (a double-JSON-encoded string sailing
// past a `?? []`-only guard) but for `columns`/`tabs`, which iterate with `.map()` directly
// rather than going through compileChildren.
function coerceArray<T>(value: T[] | undefined, path: string, ctx: CompileContext): T[] {
	if (value !== undefined && !Array.isArray(value)) {
		ctx.diagnostics.push(diagnostic(path, 'Expected an array but got something else.'));
		return [];
	}
	return Array.isArray(value) ? value : [];
}

function compileChildren(
	blocks: NotebookBlueprintBlock[] | undefined,
	path: string,
	ctx: CompileContext
): PMNodeJSON[] {
	// `!blocks?.length` only guards null/undefined/empty — a non-array value with a truthy
	// `.length` (most commonly a double-JSON-encoded string, e.g. the model sent
	// `"blocks":"[{...}]"` instead of a real array for a nested field like grid.items or
	// tabs[].blocks) sails straight through to `.flatMap`, which doesn't exist on a string.
	// Found live: crashed the whole /api/ai/chat request with "blocks.flatMap is not a
	// function" instead of a repairable diagnostic. Used for every blocks-array field in the
	// blueprint schema (top-level blocks, grid.items, columns[].blocks, tabs[].blocks,
	// card/callout/details.blocks, conditional.then/else), so this guard matters everywhere.
	if (blocks !== undefined && !Array.isArray(blocks)) {
		ctx.diagnostics.push(diagnostic(path, 'Expected an array of blocks but got something else.'));
		return [paragraph()];
	}
	if (!blocks?.length) return [paragraph()];
	return blocks.flatMap((block, index) => compileBlock(block, `${path}.${index}`, ctx));
}

// `NotebookBlueprintBlock`'s metric/chart/datatable/badge/progress/filter cases are typed as
// `GeneratedDashboardBlock` (see the type union above), but until this function existed nothing
// in the compileBlock/widget() path actually reused generated-dashboard.ts's semantic checks
// (icon allowlist, chart-type allowlist, span 1-4 bounds, filter-kind allowlist, iconCount/
// iconTotal bounds) — a blueprint (the ACTIVE create_notebook/apply_notebook_patch surface, not
// the legacy generated-dashboard.ts payload) with an invalid icon name, an out-of-range span, or
// an unsupported chart type compiled with zero diagnostics and silently broke at render time.
// Mirrors generated-dashboard.ts's renderBlock validation, one-for-one, against ctx.diagnostics.
function validateWidgetSemantics(
	block: Record<string, unknown>,
	path: string,
	ctx: CompileContext
): void {
	const type = block.type as string;
	const icon = block.icon as string | undefined;
	if (icon !== undefined && !isDashboardIconName(icon)) {
		ctx.diagnostics.push(
			diagnostic(
				path,
				`Unknown ${type} icon "${icon}". Supported icons: ${DASHBOARD_ICON_NAMES.join(', ')}.`,
				{
					attribute: 'icon',
					invalidValue: icon
				}
			)
		);
	}
	const span = block.span as number | undefined;
	if (span !== undefined && (!Number.isInteger(span) || span < 1 || span > 4)) {
		ctx.diagnostics.push(
			diagnostic(path, `${type} span must be an integer between 1 and 4 (got ${span}).`, {
				attribute: 'span',
				invalidValue: span
			})
		);
	}
	if (type === 'metric') {
		const iconCount = block.iconCount as number | undefined;
		const iconTotal = block.iconTotal as number | undefined;
		if (iconCount !== undefined) {
			if (!icon) {
				ctx.diagnostics.push(
					diagnostic(path, 'Metric iconCount requires an icon.', { attribute: 'iconCount' })
				);
			}
			if (!Number.isInteger(iconCount) || iconCount < 1 || iconCount > PICTOGRAM_MAX_ICONS) {
				ctx.diagnostics.push(
					diagnostic(
						path,
						`Metric iconCount must be an integer between 1 and ${PICTOGRAM_MAX_ICONS} (got ${iconCount}).`,
						{ attribute: 'iconCount', invalidValue: iconCount }
					)
				);
			}
		}
		if (iconTotal !== undefined) {
			if (iconCount === undefined) {
				ctx.diagnostics.push(
					diagnostic(path, 'Metric iconTotal requires iconCount (the filled portion).', {
						attribute: 'iconTotal'
					})
				);
			} else if (
				!Number.isInteger(iconTotal) ||
				iconTotal < iconCount ||
				iconTotal > PICTOGRAM_MAX_ICONS
			) {
				ctx.diagnostics.push(
					diagnostic(
						path,
						`Metric iconTotal must be an integer >= iconCount and <= ${PICTOGRAM_MAX_ICONS} (got ${iconTotal}).`,
						{ attribute: 'iconTotal', invalidValue: iconTotal }
					)
				);
			}
		}
	}
	if (type === 'chart') {
		const chartType = block.chartType as string | undefined;
		if (chartType !== undefined && !CHART_TYPES.has(chartType)) {
			ctx.diagnostics.push(
				diagnostic(path, `Unsupported chart type "${chartType}".`, {
					attribute: 'chartType',
					invalidValue: chartType
				})
			);
		}
	}
	if (type === 'filter') {
		const kind = block.kind as string | undefined;
		if (kind !== undefined && kind !== 'multi' && !FILTER_KINDS.has(kind)) {
			ctx.diagnostics.push(
				diagnostic(
					path,
					`Unsupported filter kind "${kind}". Supported: ${[...FILTER_KINDS].join(', ')}.`,
					{
						attribute: 'kind',
						invalidValue: kind
					}
				)
			);
		}
	}
}

const GRID_DISALLOWED_ITEM_TYPES = new Set(['chart', 'datatable', 'mermaid', 'columns', 'tabs']);

// Mirrors generated-dashboard.ts's 'grid' case validation (item-type restriction, cols<=4,
// item-count cap, span-vs-cols) — see validateWidgetSemantics' comment for why this needs to
// exist here too, not just in the legacy generated-dashboard.ts compiler.
function validateGridSemantics(
	block: { cols?: number; items?: unknown },
	path: string,
	ctx: CompileContext
): void {
	const items = Array.isArray(block.items) ? (block.items as Record<string, unknown>[]) : [];
	for (const item of items) {
		if (GRID_DISALLOWED_ITEM_TYPES.has(item.type as string)) {
			ctx.diagnostics.push(
				diagnostic(
					path,
					`Grid items must be small tiles (metric/badge/progress/card) — put "${item.type}" content in an asymmetric columns block or a top-level block instead.`,
					{ attribute: 'type', invalidValue: item.type }
				)
			);
		}
	}
	if (block.cols !== undefined && block.cols > 4) {
		ctx.diagnostics.push(
			diagnostic(
				path,
				`Grid cols must be 4 or fewer (got ${block.cols}) — split into multiple sections instead of a wide grid.`,
				{
					attribute: 'cols',
					invalidValue: block.cols
				}
			)
		);
	}
	const gridItemCap = (block.cols ?? 3) === 1 ? 8 : (block.cols ?? 3) * 3;
	if (items.length > gridItemCap) {
		ctx.diagnostics.push(
			diagnostic(
				path,
				`Grid has ${items.length} items, too many for cols=${block.cols ?? 3} — split into another section or use a datatable.`,
				{ attribute: 'items', invalidValue: items.length }
			)
		);
	}
	// Item-level checks (icon/chartType/span-1-to-4/iconCount/filter-kind) already run once each
	// via the item's own compileBlock dispatch below — only the grid-fit check needs grid context.
	const gridCols = Math.min(block.cols ?? 3, 4);
	items.forEach((item, index) => {
		const span = item.span as number | undefined;
		if (
			typeof span === 'number' &&
			Number.isInteger(span) &&
			span >= 1 &&
			span <= 4 &&
			span > gridCols
		) {
			ctx.diagnostics.push(
				diagnostic(
					`${path}.items.${index}`,
					`${item.type} span=${span} exceeds its grid's cols=${gridCols}.`,
					{ attribute: 'span', invalidValue: span }
				)
			);
		}
	});
}

interface CompileContext {
	queryBlockCellIds: Set<string>;
	knownRefs: Set<string>;
	diagnostics: NotebookBlueprintDiagnostic[];
	// Keyed by cellId. Authoritative source for a queryBlock node's `cellType` attr — see the
	// 'queryBlock' case below for why this can't just trust the block's own `cellType` field.
	executableCellTypes: Map<string, NotebookExecutableBlueprint['cellType']>;
}

function compileBlock(
	block: NotebookBlueprintBlock,
	path: string,
	ctx: CompileContext
): PMNodeJSON[] {
	if (!block || typeof block !== 'object') {
		ctx.diagnostics.push(diagnostic(path, 'Block must be an object.'));
		return [];
	}

	// 'markdown' is a natural, common model guess for the prose block type (arguably more
	// intuitive than 'text', since the block literally holds Markdoc/markdown prose) — found
	// live against a real model failing its very first apply_notebook_patch on exactly this.
	// Normalize it rather than rejecting, same alias pattern as filter's legacy 'multi'.
	if ((block as { type?: unknown }).type === 'markdown') {
		block = { ...(block as Record<string, unknown>), type: 'text' } as NotebookBlueprintBlock;
	}

	// A self-closing `markdocWidget` PM node (`{"type":"markdocWidget","attrs":{"tagName":
	// "metric","attrsJson":"{...}","selfClosing":true}}`) is the exact shape apply_notebook_patch's
	// OWN `operations` tool-schema description teaches for widgets (see native-schemas.ts) — a
	// model juggling both the `blueprint` shape (flat `{"type":"metric",...}` blocks) and the
	// `document`/`operations` shape (raw PM nodes) in the same tool call can blend the two,
	// sending a raw PM widget node where a blueprint block was expected. Found live: a real model
	// did exactly this for 3 widgets in a row and, given only "Unsupported block type
	// markdocWidget" as feedback, never adapted — it kept resubmitting the identical shape for
	// its entire remaining turn budget. Unwrap it back into the flat blueprint shape (tagName
	// becomes the block type, attrsJson's parsed keys become the block's own fields) rather than
	// reject a shape we taught the model ourselves in the same request.
	if ((block as { type?: unknown }).type === 'markdocWidget') {
		const attrs = (block as { attrs?: { tagName?: unknown; attrsJson?: unknown } }).attrs ?? {};
		const tagName = attrs.tagName;
		if (typeof tagName === 'string') {
			block = {
				...parseAttrsJson(attrs.attrsJson),
				type: tagName
			} as NotebookBlueprintBlock;
		}
	}

	// There is no "dashboard"/"section" container node in the schema — a model asked to "add a
	// dashboard section" naturally reaches for a wrapper type that mirrors the prompt's own
	// vocabulary. Found live: a real model, told to add a dashboard section, wrapped its
	// metric/chart/datatable widgets in exactly this and then retried the identical rejected
	// call for its entire remaining turn budget without ever adapting. The blueprint's `blocks`
	// array can already hold any block type directly at any nesting level, so the correct fix is
	// to splice the wrapper's own `.blocks` straight into the parent rather than reject it
	// outright — same alias philosophy as 'markdown' -> 'text' above.
	const blockType = (block as { type?: unknown }).type;
	if (blockType === 'dashboard' || blockType === 'section') {
		const nested = (block as Record<string, unknown>).blocks;
		return compileChildren(nested as NotebookBlueprintBlock[], `${path}.blocks`, ctx);
	}

	switch (block.type) {
		case 'queryBlock': {
			if (!block.cellId?.trim()) {
				ctx.diagnostics.push(
					diagnostic(path, 'queryBlock requires cellId.', { nodeType: 'queryBlock' })
				);
				return [];
			}
			if (!ctx.queryBlockCellIds.has(block.cellId)) {
				ctx.diagnostics.push(
					diagnostic(path, `queryBlock references missing executable cell "${block.cellId}".`, {
						nodeType: 'queryBlock',
						attribute: 'cellId',
						invalidValue: block.cellId
					})
				);
			}
			// A queryBlock's `cellType` attr — not the block's own field — is what
			// rebuildCellsFromBlocks (notebook.svelte.ts) uses to construct a brand-new cell when
			// one doesn't exist yet for this cellId. If it disagrees with the matching
			// executableCells[].cellType (e.g. the model wrote a python executableCell but left
			// this queryBlock's cellType at its 'query' default), the cell gets created as a SQL
			// stub; materializeNotebookExecutableCells then sees a cell already occupying that id
			// and skips it; and updatePythonCellCode's `cell.cellType !== 'python'` guard silently
			// drops the code with no error — apply_notebook_patch still reports "patched and
			// validated". Always prefer the executableCells entry as the source of truth.
			return [
				{
					type: 'queryBlock',
					attrs: {
						cellId: block.cellId,
						cellType: ctx.executableCellTypes.get(block.cellId) ?? block.cellType ?? 'query',
						pinned: block.pinned ?? true
					}
				}
			];
		}
		case 'text':
			// `block.content` is model-supplied text straight off the wire — a 'text' block
			// missing its `content` field (or sending a non-string) crashed the whole request
			// with "Cannot read properties of undefined (reading 'match')" deep inside
			// markdownToPmDocument's frontmatter regex instead of a repairable diagnostic.
			if (typeof block.content !== 'string') {
				ctx.diagnostics.push(
					diagnostic(`${path}.content`, 'text block requires a string `content`.')
				);
				return [paragraph()];
			}
			validateKnownRef(block.content, ctx.knownRefs, `${path}.content`, ctx.diagnostics);
			return textNodesFromMarkdown(block.content);
		case 'divider':
			return [{ type: 'horizontalRule' }];
		case 'grid':
			validateGridSemantics(block, path, ctx);
			return [
				container(
					'grid',
					compileChildren(block.items as NotebookBlueprintBlock[], `${path}.items`, ctx),
					attrsFromBlock(block, ['type', 'items'])
				)
			];
		case 'columns':
			return [
				container(
					'columns',
					coerceArray(block.columns, `${path}.columns`, ctx).map((column, index) =>
						container(
							'column',
							compileChildren(
								column.blocks as NotebookBlueprintBlock[],
								`${path}.columns.${index}.blocks`,
								ctx
							),
							attrsFromBlock(column as Record<string, unknown>, ['blocks'])
						)
					),
					attrsFromBlock(block, ['type', 'columns'])
				)
			];
		case 'card':
		case 'callout':
		case 'details':
			if (block.type === 'card' || block.type === 'callout') {
				validateWidgetSemantics(block as Record<string, unknown>, path, ctx);
			}
			return [
				container(
					block.type,
					compileChildren(block.blocks as NotebookBlueprintBlock[], `${path}.blocks`, ctx),
					// callout's `variant` field renders as the markdoc attr `type` (the runtime
					// callout tag/node view reads attrs.type, e.g. markdoc-container-extension.ts's
					// `String(attrs.type ?? 'info')`) — attrsFromBlock alone would carry the raw
					// field name `variant` through and every AI-generated callout would silently
					// render with the 'info' default regardless of the requested tone.
					block.type === 'callout' && 'variant' in block
						? attrsFromBlock({ ...block, type: (block as { variant?: string }).variant }, [
								'variant',
								'blocks'
							])
						: attrsFromBlock(block, ['type', 'blocks'])
				)
			];
		case 'tabs':
			return [
				container(
					'tabs',
					coerceArray(block.tabs, `${path}.tabs`, ctx).map((tab, index) =>
						container(
							'tab',
							compileChildren(
								tab.blocks as NotebookBlueprintBlock[],
								`${path}.tabs.${index}.blocks`,
								ctx
							),
							{ label: tab.label }
						)
					)
				)
			];
		case 'mermaid': {
			validateKnownRef(block.codeRef, ctx.knownRefs, `${path}.codeRef`, ctx.diagnostics);
			if (block.codeRef) return [container('mermaid', [paragraph()], { code: block.codeRef })];
			return [
				container('mermaid', [
					{
						type: 'codeBlock',
						attrs: { language: 'mermaid' },
						content: block.code ? [{ type: 'text', text: block.code.trim() }] : undefined
					}
				])
			];
		}
		case 'each':
		case 'group':
			validateKnownRef(block.data, ctx.knownRefs, `${path}.data`, ctx.diagnostics);
			return [
				container(
					block.type,
					textNodesFromMarkdown(block.template?.trim() || ' '),
					attrsFromBlock(block, ['type', 'template'])
				)
			];
		case 'conditional': {
			// `test` is a required field, but it's model-supplied — an omitted or malformed
			// `test` (not an object) previously crashed with "Cannot read properties of
			// undefined (reading 'left')" instead of a repairable diagnostic.
			if (!block.test || typeof block.test !== 'object') {
				ctx.diagnostics.push(
					diagnostic(`${path}.test`, 'conditional requires a test: {op, left, right}.')
				);
				return [];
			}
			validateKnownRef(block.test.left, ctx.knownRefs, `${path}.test.left`, ctx.diagnostics);
			validateKnownRef(block.test.right, ctx.knownRefs, `${path}.test.right`, ctx.diagnostics);
			const condition = `${block.test.op}(${JSON.stringify(scalar(block.test.left))}, ${JSON.stringify(
				scalar(block.test.right)
			)})`;
			const content = compileChildren(block.then as NotebookBlueprintBlock[], `${path}.then`, ctx);
			if (block.else?.length) {
				content.push(widget('else'));
				content.push(
					...compileChildren(block.else as NotebookBlueprintBlock[], `${path}.else`, ctx)
				);
			}
			return [container('if', content, { condition })];
		}
		case 'metric':
		case 'chart':
		case 'datatable':
		case 'badge':
		case 'progress':
		case 'filter':
		case 'toc':
		case 'math':
		case 'video':
		case 'embed':
		case 'bookmark': {
			for (const value of Object.values(block))
				validateKnownRef(value, ctx.knownRefs, path, ctx.diagnostics);
			validateWidgetSemantics(block as Record<string, unknown>, path, ctx);
			if (block.type === 'chart') {
				// chart's `chartType` field renders as the markdoc attr `type` (the runtime chart
				// widget reads attrs.type, e.g. InlineWidgetNodeView.svelte's
				// `attr(attrs.title, attr(attrs.type, 'Chart'))`) — attrsFromBlock alone would
				// carry the raw field name `chartType` through and every AI-generated chart's
				// requested type would silently be dropped, falling back to the render-time
				// default ('bar').
				const chartAttrs = attrsFromBlock({ ...block, type: block.chartType }, ['chartType']);
				return [widget('chart', chartAttrs)];
			}
			// 'multi' is a legacy alias older prompts taught — the runtime filter tag only
			// accepts 'multi-select' (see FILTER_KINDS/generated-dashboard.ts's renderBlock).
			// Without this normalization the widget's attrsJson would carry kind="multi" and
			// silently fail to render as the intended multi-select filter.
			const attrs =
				block.type === 'filter' && (block as { kind?: string }).kind === 'multi'
					? { ...block, kind: 'multi-select' }
					: block;
			return [widget(block.type, attrsFromBlock(attrs))];
		}
		default:
			ctx.diagnostics.push(
				diagnostic(
					path,
					`Unsupported block type "${String((block as { type?: unknown }).type)}".`,
					{
						invalidValue: (block as { type?: unknown }).type
					}
				)
			);
			return [];
	}
}

function parseAttrsJson(attrsJson: unknown): Record<string, unknown> {
	if (typeof attrsJson !== 'string') return {};
	try {
		const parsed = JSON.parse(attrsJson);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

const GRID_DISALLOWED_WIDGET_TAGS = new Set(['chart', 'datatable']);
const GRID_DISALLOWED_CONTAINER_TAGS = new Set(['mermaid', 'columns', 'tabs']);

// Same semantic-validation gap as validateWidgetSemantics/validateGridSemantics above, but for
// the `document`/`operations` `apply_notebook_patch` shapes and the `validate_notebook` tool,
// which hand raw PM JSON straight to validateNotebookPmDocument and never go through
// compileBlock/compileNotebookBlueprint at all — an invalid icon/chartType/span/filter-kind or a
// chart nested in a grid tile sent via `document`/`operations` compiled clean with zero
// diagnostics here too, and validate_notebook itself would report a false "ok: true".
function validatePmWidgetSemantics(
	tagName: string,
	attrs: Record<string, unknown>,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[]
): void {
	const icon = attrs.icon as string | undefined;
	if (icon !== undefined && !isDashboardIconName(icon)) {
		diagnostics.push(
			diagnostic(
				path,
				`Unknown ${tagName} icon "${icon}". Supported icons: ${DASHBOARD_ICON_NAMES.join(', ')}.`,
				{
					nodeType: tagName,
					attribute: 'icon',
					invalidValue: icon
				}
			)
		);
	}
	const span = attrs.span as number | undefined;
	if (span !== undefined && (!Number.isInteger(span) || span < 1 || span > 4)) {
		diagnostics.push(
			diagnostic(path, `${tagName} span must be an integer between 1 and 4 (got ${span}).`, {
				nodeType: tagName,
				attribute: 'span',
				invalidValue: span
			})
		);
	}
	if (tagName === 'metric') {
		const iconCount = attrs.iconCount as number | undefined;
		const iconTotal = attrs.iconTotal as number | undefined;
		if (iconCount !== undefined) {
			if (!icon) {
				diagnostics.push(
					diagnostic(path, 'Metric iconCount requires an icon.', {
						nodeType: tagName,
						attribute: 'iconCount'
					})
				);
			}
			if (!Number.isInteger(iconCount) || iconCount < 1 || iconCount > PICTOGRAM_MAX_ICONS) {
				diagnostics.push(
					diagnostic(
						path,
						`Metric iconCount must be an integer between 1 and ${PICTOGRAM_MAX_ICONS} (got ${iconCount}).`,
						{ nodeType: tagName, attribute: 'iconCount', invalidValue: iconCount }
					)
				);
			}
		}
		if (iconTotal !== undefined) {
			if (iconCount === undefined) {
				diagnostics.push(
					diagnostic(path, 'Metric iconTotal requires iconCount (the filled portion).', {
						nodeType: tagName,
						attribute: 'iconTotal'
					})
				);
			} else if (
				!Number.isInteger(iconTotal) ||
				iconTotal < iconCount ||
				iconTotal > PICTOGRAM_MAX_ICONS
			) {
				diagnostics.push(
					diagnostic(
						path,
						`Metric iconTotal must be an integer >= iconCount and <= ${PICTOGRAM_MAX_ICONS} (got ${iconTotal}).`,
						{ nodeType: tagName, attribute: 'iconTotal', invalidValue: iconTotal }
					)
				);
			}
		}
	}
	if (tagName === 'chart') {
		const chartType = attrs.type as string | undefined;
		if (chartType !== undefined && !CHART_TYPES.has(chartType)) {
			diagnostics.push(
				diagnostic(path, `Unsupported chart type "${chartType}".`, {
					nodeType: tagName,
					attribute: 'chartType',
					invalidValue: chartType
				})
			);
		}
	}
	if (tagName === 'filter') {
		const kind = attrs.kind as string | undefined;
		if (kind !== undefined && kind !== 'multi' && !FILTER_KINDS.has(kind)) {
			diagnostics.push(
				diagnostic(
					path,
					`Unsupported filter kind "${kind}". Supported: ${[...FILTER_KINDS].join(', ')}.`,
					{
						nodeType: tagName,
						attribute: 'kind',
						invalidValue: kind
					}
				)
			);
		}
	}
}

function validateContainerRules(
	node: PMNodeJSON,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[]
): void {
	if (node.type === 'markdocWidget') {
		const tagName = String(node.attrs?.tagName ?? '');
		validatePmWidgetSemantics(tagName, parseAttrsJson(node.attrs?.attrsJson), path, diagnostics);
	}
	if (node.type === 'markdocContainer') {
		const tagName = String(node.attrs?.tagName ?? '');
		const requiredChildTag = CONTAINER_CHILD_RULES[tagName];
		const children = contentArray(node);
		if (tagName === 'card' || tagName === 'callout') {
			validatePmWidgetSemantics(tagName, parseAttrsJson(node.attrs?.attrsJson), path, diagnostics);
		}
		if (!children.length) {
			diagnostics.push(
				diagnostic(path, 'Container must contain at least one block.', { nodeType: tagName })
			);
		}
		if (requiredChildTag) {
			for (let i = 0; i < children.length; i++) {
				const child = children[i]!;
				if (child.type !== 'markdocContainer' || child.attrs?.tagName !== requiredChildTag) {
					diagnostics.push(
						diagnostic(
							`${path}.content.${i}`,
							`${tagName} may only contain ${requiredChildTag} containers.`,
							{ nodeType: child.type, invalidValue: child.attrs?.tagName }
						)
					);
				}
			}
		}
		if (tagName === 'grid') {
			const gridAttrs = parseAttrsJson(node.attrs?.attrsJson);
			const cols = gridAttrs.cols as number | undefined;
			if (cols !== undefined && cols > 4) {
				diagnostics.push(
					diagnostic(
						path,
						`Grid cols must be 4 or fewer (got ${cols}) — split into multiple sections instead of a wide grid.`,
						{
							nodeType: tagName,
							attribute: 'cols',
							invalidValue: cols
						}
					)
				);
			}
			const gridItemCap = (cols ?? 3) === 1 ? 8 : (cols ?? 3) * 3;
			if (children.length > gridItemCap) {
				diagnostics.push(
					diagnostic(
						path,
						`Grid has ${children.length} items, too many for cols=${cols ?? 3} — split into another section or use a datatable.`,
						{ nodeType: tagName, attribute: 'items', invalidValue: children.length }
					)
				);
			}
			const gridCols = Math.min(cols ?? 3, 4);
			for (let i = 0; i < children.length; i++) {
				const child = children[i]!;
				const childTag = String(child.attrs?.tagName ?? '');
				const disallowed =
					(child.type === 'markdocWidget' && GRID_DISALLOWED_WIDGET_TAGS.has(childTag)) ||
					(child.type === 'markdocContainer' && GRID_DISALLOWED_CONTAINER_TAGS.has(childTag));
				if (disallowed) {
					diagnostics.push(
						diagnostic(
							`${path}.content.${i}`,
							`Grid items must be small tiles (metric/badge/progress/card) — put "${childTag}" content in an asymmetric columns block or a top-level block instead.`,
							{ nodeType: childTag, attribute: 'type', invalidValue: childTag }
						)
					);
				}
				const childSpan = parseAttrsJson(child.attrs?.attrsJson).span as number | undefined;
				if (
					typeof childSpan === 'number' &&
					Number.isInteger(childSpan) &&
					childSpan >= 1 &&
					childSpan <= 4 &&
					childSpan > gridCols
				) {
					diagnostics.push(
						diagnostic(
							`${path}.content.${i}`,
							`${childTag} span=${childSpan} exceeds its grid's cols=${gridCols}.`,
							{ nodeType: childTag, attribute: 'span', invalidValue: childSpan }
						)
					);
				}
			}
		}
	}
	contentArray(node).forEach((child, index) =>
		validateContainerRules(child, `${path}.content.${index}`, diagnostics)
	);
}

// `each`/`group` containers introduce loop-scoped bare tokens (e.g. `$row` aliased from the
// loop's `alias` attr) inside their own content — those are not top-level cell refs and must
// not be checked against knownRefs, mirroring compileBlock's each/group case which validates
// `block.data` but deliberately skips `block.template`.
const LOOP_CONTAINER_TAGS = new Set(['each', 'group']);

function collectRefRoots(text: string): string[] {
	const roots: string[] = [];
	for (const match of text.matchAll(/\$([A-Za-z_]\w*)/g)) roots.push(match[1]);
	return roots;
}

function pushUnknownRefs(
	roots: string[],
	knownRefs: Set<string>,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[]
): void {
	for (const root of roots) {
		if (root === 'key' || root === 'keyId' || root === 'items') continue;
		if (!knownRefs.has(root)) {
			diagnostics.push(
				diagnostic(path, `Unknown live reference "${root}".`, {
					attribute: 'ref',
					invalidValue: root
				})
			);
		}
	}
}

function validateDocumentRefs(
	node: PMNodeJSON,
	knownRefs: Set<string>,
	path: string,
	diagnostics: NotebookBlueprintDiagnostic[],
	insideLoopScope: boolean
): void {
	if (node.type === 'markdocWidget') {
		if (!insideLoopScope) {
			pushUnknownRefs(
				collectRefRoots(String(node.attrs?.attrsJson ?? '{}')),
				knownRefs,
				path,
				diagnostics
			);
		}
		return;
	}
	if (node.type === 'markdocContainer') {
		const tagName = String(node.attrs?.tagName ?? '');
		if (!insideLoopScope) {
			pushUnknownRefs(
				collectRefRoots(String(node.attrs?.attrsJson ?? '{}')),
				knownRefs,
				path,
				diagnostics
			);
		}
		const nextInsideLoop = insideLoopScope || LOOP_CONTAINER_TAGS.has(tagName);
		contentArray(node).forEach((child, index) =>
			validateDocumentRefs(
				child,
				knownRefs,
				`${path}.content.${index}`,
				diagnostics,
				nextInsideLoop
			)
		);
		return;
	}
	if (node.type === 'text' && !insideLoopScope) {
		// Only a `.field` access is unambiguous cell-reference intent (a lone `$word` in prose
		// could be a stray dollar sign) — same convention as markdoc-interp.ts's bare-ref check.
		const text = String(node.text ?? '');
		const roots = [...text.matchAll(/\$([A-Za-z_]\w*)\.[A-Za-z_]/g)].map((m) => m[1]);
		pushUnknownRefs(roots, knownRefs, path, diagnostics);
	}
	contentArray(node).forEach((child, index) =>
		validateDocumentRefs(child, knownRefs, `${path}.content.${index}`, diagnostics, insideLoopScope)
	);
}

export function validateNotebookPmDocument(
	doc: PMDocJSON,
	knownRefs?: Iterable<string>
): NotebookBlueprintDiagnostic[] {
	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	try {
		// The PMDocJSON/PMNodeJSON shape used throughout this file is Tiptap-style (camelCase:
		// horizontalRule, bulletList, codeBlock, ...), but getMarkdocPmSchema()'s underlying
		// schema is prosemirror-markdown's defaultMarkdownParser.schema, which registers these
		// under snake_case names (horizontal_rule, bullet_list, code_block, ...). Every other
		// caller of nodeFromJSON in markdoc-pm.ts converts via tiptapNodeJsonToPm first — this
		// check didn't, so ANY document containing a divider, list, code block, hard break, or
		// task list (extremely common in AI-written prose) was rejected as "Unknown node type".
		getMarkdocPmSchema().nodeFromJSON(tiptapNodeJsonToPm(doc as unknown as PMNodeJSON));
	} catch (error) {
		diagnostics.push(
			diagnostic('doc', error instanceof Error ? error.message : 'Invalid ProseMirror document.')
		);
	}
	contentArray(doc).forEach((node, index) =>
		validateContainerRules(node, `doc.content.${index}`, diagnostics)
	);
	if (knownRefs) {
		const refSet = new Set(knownRefs);
		contentArray(doc).forEach((node, index) =>
			validateDocumentRefs(node, refSet, `doc.content.${index}`, diagnostics, false)
		);
	}
	try {
		const withoutQueryBlocks: PMDocJSON = {
			type: 'doc',
			content: contentArray(doc).filter((node) => node.type !== 'queryBlock')
		};
		markdownToPmDocument(pmDocumentToMarkdown({ frontmatter: '', doc: withoutQueryBlocks }));
	} catch (error) {
		diagnostics.push(
			diagnostic(
				'doc',
				error instanceof Error ? error.message : 'Document failed markdown round-trip parse.'
			)
		);
	}
	return diagnostics;
}

export function compileNotebookBlueprint(
	blueprint: NotebookBlueprint,
	knownRefs: Iterable<string> = [],
	knownCellIds: Iterable<string> = []
): CompileNotebookBlueprintResult {
	// `blueprint` is hand-constructed model output straight off the wire — `?? []` only guards
	// null/undefined. Found live: a real model's malformed tool-call JSON (an illegal `\'` escape)
	// got dropped by the SSE parser, and a later retry sent `executableCells` as something other
	// than an array; `.map()` below then crashed the WHOLE /api/ai/chat request with an unhandled
	// exception instead of a repairable diagnostic. Same defensive-coercion pattern as
	// contentArray() above, but surfaced as a diagnostic since a malformed executableCells is a
	// real, actionable model mistake (not an incidental raw-PM edge case).
	const executableCellsRaw = blueprint.executableCells;
	const executableCells = Array.isArray(executableCellsRaw) ? executableCellsRaw : [];
	const diagnosticsFromMalformedInput: NotebookBlueprintDiagnostic[] =
		executableCellsRaw !== undefined && !Array.isArray(executableCellsRaw)
			? [
					diagnostic('executableCells', 'executableCells must be an array.', {
						invalidValue: executableCellsRaw
					})
				]
			: [];
	const ctx: CompileContext = {
		queryBlockCellIds: new Set([...knownCellIds, ...executableCells.map((cell) => cell.cellId)]),
		knownRefs: new Set([...knownRefs, ...executableCells.map((cell) => cell.outputName)]),
		diagnostics: [...diagnosticsFromMalformedInput],
		executableCellTypes: new Map(executableCells.map((cell) => [cell.cellId, cell.cellType]))
	};

	const content: PMNodeJSON[] = [];
	if (blueprint.title?.trim()) {
		content.push({
			type: 'heading',
			attrs: { level: 1 },
			content: [{ type: 'text', text: blueprint.title.trim() }]
		});
	}
	content.push(...compileChildren(blueprint.blocks, 'blocks', ctx));
	if (!content.length) content.push(paragraph());

	const document = normalizePmNodeIds({ type: 'doc', content });
	const diagnostics = [...ctx.diagnostics, ...validateNotebookPmDocument(document)];
	return {
		document: diagnostics.length ? null : document,
		executableCells,
		diagnostics
	};
}

function findChildContainer(
	doc: PMDocJSON,
	nodeId: string | undefined,
	diagnostics: NotebookBlueprintDiagnostic[]
): PMDocJSON | PMNodeJSON | null {
	if (!nodeId) return doc;
	const visit = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON | null => {
		if (node.attrs?.nodeId === nodeId) return node;
		for (const child of contentArray(node)) {
			const found = visit(child);
			if (found) return found;
		}
		return null;
	};
	const found = visit(doc);
	if (!found)
		diagnostics.push(diagnostic('patch', `Node "${nodeId}" not found.`, { invalidValue: nodeId }));
	return found;
}

function removeNode(
	doc: PMDocJSON,
	nodeId: string
): { document: PMDocJSON; removed: PMNodeJSON | null } {
	let removed: PMNodeJSON | null = null;
	const walk = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON => {
		const content: PMNodeJSON[] = [];
		for (const child of contentArray(node)) {
			if (child.attrs?.nodeId === nodeId) {
				removed = child;
				continue;
			}
			content.push(walk(child) as PMNodeJSON);
		}
		return { ...node, content };
	};
	return { document: walk(doc) as PMDocJSON, removed };
}

function replaceNode(doc: PMDocJSON, nodeId: string, nextNode: PMNodeJSON): PMDocJSON {
	const walk = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON => ({
		...node,
		content: contentArray(node).map((child) =>
			child.attrs?.nodeId === nodeId ? nextNode : (walk(child) as PMNodeJSON)
		)
	});
	return walk(doc) as PMDocJSON;
}

export function applyNotebookPatchOperations(
	document: PMDocJSON,
	operations: NotebookPatchOperation[]
): ApplyNotebookPatchResult {
	const diagnostics: NotebookBlueprintDiagnostic[] = [];
	let next = normalizePmNodeIds(document);

	for (let index = 0; index < operations.length; index++) {
		const op = operations[index]!;
		const path = `operations.${index}`;
		if (op.op === 'replace_document') {
			next = normalizePmNodeIds(op.document);
			continue;
		}
		if (op.op === 'delete_node') {
			const removed = removeNode(next, op.nodeId);
			next = removed.document;
			if (!removed.removed) diagnostics.push(diagnostic(path, `Node "${op.nodeId}" not found.`));
			continue;
		}
		if (op.op === 'replace_node') {
			const normalized = normalizePmNodeIds({ type: 'doc', content: [op.node] }).content?.[0];
			if (!normalized) {
				diagnostics.push(diagnostic(path, 'Replacement node is invalid.'));
				continue;
			}
			next = replaceNode(next, op.nodeId, normalized);
			continue;
		}
		if (op.op === 'patch_attrs') {
			let patched = false;
			const walk = (node: PMDocJSON | PMNodeJSON): PMDocJSON | PMNodeJSON => {
				if (node.attrs?.nodeId === op.nodeId) {
					patched = true;
					return { ...node, attrs: { ...(node.attrs ?? {}), ...op.attrs, nodeId: op.nodeId } };
				}
				return { ...node, content: contentArray(node).map((child) => walk(child) as PMNodeJSON) };
			};
			next = walk(next) as PMDocJSON;
			if (!patched) diagnostics.push(diagnostic(path, `Node "${op.nodeId}" not found.`));
			continue;
		}
		if (op.op === 'insert_node') {
			const parent = findChildContainer(next, op.parentNodeId, diagnostics);
			if (!parent) continue;
			const normalized = normalizePmNodeIds({ type: 'doc', content: [op.node] }).content?.[0];
			if (!normalized) {
				diagnostics.push(diagnostic(path, 'Inserted node is invalid.'));
				continue;
			}
			const content = [...contentArray(parent)];
			content.splice(
				Math.max(0, Math.min(op.index ?? content.length, content.length)),
				0,
				normalized
			);
			parent.content = content;
			continue;
		}
		if (op.op === 'move_node') {
			const removed = removeNode(next, op.nodeId);
			if (!removed.removed) {
				diagnostics.push(diagnostic(path, `Node "${op.nodeId}" not found.`));
				continue;
			}
			next = removed.document;
			const parent = findChildContainer(next, op.parentNodeId, diagnostics);
			if (!parent) continue;
			const content = [...contentArray(parent)];
			content.splice(Math.max(0, Math.min(op.index, content.length)), 0, removed.removed);
			parent.content = content;
		}
	}

	next = normalizePmNodeIds(next);
	diagnostics.push(...validateNotebookPmDocument(next));
	return { document: diagnostics.length ? null : next, diagnostics };
}
