import { Schema, type Node as PMNode } from 'prosemirror-model';
import {
	defaultMarkdownParser,
	defaultMarkdownSerializer,
	MarkdownSerializer
} from 'prosemirror-markdown';
import {
	parseVisualBlocks,
	parseBlockWidget,
	serializeMarkdocTag,
	splitFrontmatter,
	markdocAttrsToJson,
	type VisualBlock,
	type VisualBlockKind
} from './markdoc-ast';
import { isStructuredMarkdocContainerTag } from './markdoc-tag-registry';
import { parseAttrsJson as parseWidgetAttrsJson } from '../components/markdown/visual/widget-registry';

/** JSON shape compatible with TipTap `setContent` / `getJSON`. */
export interface PMMarkJSON {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface PMNodeJSON extends PMMarkJSON {
	content?: PMNodeJSON[];
	text?: string;
	marks?: PMMarkJSON[];
}

export interface PMDocJSON {
	type: 'doc';
	attrs?: Record<string, unknown>;
	content?: PMNodeJSON[];
}

export interface MarkdocPmDocument {
	frontmatter: string;
	doc: PMDocJSON;
}

function hashNodeId(value: string): string {
	let hash = 5381;
	for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i);
	return `n_${(hash >>> 0).toString(36)}`;
}

function nodeFingerprint(node: PMNodeJSON | PMDocJSON, path: string): string {
	const attrs = { ...(node.attrs ?? {}) };
	delete attrs.nodeId;
	return JSON.stringify({
		path,
		type: node.type,
		text: 'text' in node ? node.text : undefined,
		attrs
	});
}

export function normalizePmNodeIds(doc: PMDocJSON): PMDocJSON {
	const seen = new Set<string>();
	const normalize = (node: PMNodeJSON | PMDocJSON, path: string): PMNodeJSON | PMDocJSON => {
		if (node.type === 'text') return node;
		const current = String(node.attrs?.nodeId ?? '').trim();
		let nodeId = current && !seen.has(current) ? current : hashNodeId(nodeFingerprint(node, path));
		let counter = 1;
		while (seen.has(nodeId)) nodeId = `${nodeId}_${counter++}`;
		seen.add(nodeId);
		// A content array's ELEMENTS can be malformed (null/undefined/non-object) even when the
		// array itself is well-formed — e.g. a patch operation's `op.node` arriving as undefined
		// gets wrapped as `content: [op.node]` by a caller before reaching here. Filtering here,
		// not just at the array level, protects every caller of this shared utility rather than
		// requiring each one to defensively pre-validate. Found live: crashed with "Cannot read
		// properties of undefined (reading 'type')" instead of just dropping the bad entry.
		const validChildren = (node.content ?? []).filter(
			(child): child is PMNodeJSON => !!child && typeof child === 'object'
		);
		return {
			...node,
			attrs: { ...(node.attrs ?? {}), nodeId },
			...(validChildren.length > 0
				? {
						content: validChildren.map((child, index) =>
							normalize(child, `${path}.content.${index}`)
						) as PMNodeJSON[]
					}
				: {})
		};
	};
	return normalize(doc, 'doc') as PMDocJSON;
}

export function collectPmNodeIds(doc: PMDocJSON): string[] {
	const ids: string[] = [];
	const visit = (node: PMNodeJSON | PMDocJSON) => {
		const nodeId = String(node.attrs?.nodeId ?? '').trim();
		if (nodeId) ids.push(nodeId);
		for (const child of node.content ?? []) visit(child);
	};
	visit(doc);
	return ids;
}

function isNarrativeKind(kind: VisualBlockKind): boolean {
	return kind === 'prose' || kind === 'heading';
}

function isMarkdocAtomKind(kind: VisualBlockKind): boolean {
	return kind === 'widget' || kind === 'container' || kind === 'fence';
}

let cachedSchema: Schema | null = null;

function withNodeIdAttrs(nodes: typeof defaultMarkdownParser.schema.spec.nodes) {
	let next = nodes;
	next.forEach((name, spec) => {
		if (name === 'text') return;
		next = next.update(name, {
			...spec,
			attrs: {
				...(spec.attrs ?? {}),
				nodeId: { default: null }
			}
		});
	});
	return next;
}

/** ProseMirror schema: standard markdown nodes + Markdoc widget/container atoms. */
export function getMarkdocPmSchema(): Schema {
	if (cachedSchema) return cachedSchema;
	const base = defaultMarkdownParser.schema;
	const nodes = withNodeIdAttrs(
		base.spec.nodes.append({
			markdocBlock: {
				atom: true,
				group: 'block',
				defining: true,
				isolating: true,
				attrs: { source: { default: '' }, nodeId: { default: null } },
				parseDOM: [
					{
						tag: 'div[data-markdoc-block]',
						getAttrs: (dom) => ({
							source: (dom as HTMLElement).getAttribute('data-source') ?? ''
						})
					}
				],
				toDOM(node) {
					return [
						'div',
						{
							'data-markdoc-block': 'true',
							'data-source': node.attrs.source
						}
					];
				}
			},
			markdocWidget: {
				atom: true,
				group: 'block',
				defining: true,
				isolating: true,
				attrs: {
					tagName: { default: 'metric' },
					attrsJson: { default: '{}' },
					selfClosing: { default: true },
					nodeId: { default: null }
				},
				parseDOM: [{ tag: 'div[data-markdoc-widget]' }],
				toDOM() {
					return ['div', { 'data-markdoc-widget': 'true' }];
				}
			},
			markdocContainer: {
				group: 'block',
				content: 'block+',
				defining: true,
				isolating: true,
				attrs: {
					tagName: { default: 'callout' },
					attrsJson: { default: '{}' },
					nodeId: { default: null }
				},
				parseDOM: [{ tag: 'div[data-markdoc-container]' }],
				toDOM() {
					return ['div', { 'data-markdoc-container': 'true' }, 0];
				}
			},
			markdocExpression: {
				inline: true,
				group: 'inline',
				atom: true,
				attrs: { source: { default: '' }, nodeId: { default: null } },
				parseDOM: [{ tag: 'span[data-markdoc-expression]' }],
				toDOM(node) {
					return ['span', { 'data-markdoc-expression': 'true', 'data-source': node.attrs.source }];
				}
			},
			queryBlock: {
				atom: true,
				group: 'block',
				defining: true,
				isolating: true,
				attrs: {
					cellId: { default: '' },
					cellType: { default: 'query' },
					pinned: { default: false },
					nodeId: { default: null }
				},
				parseDOM: [{ tag: 'div[data-query-block]' }],
				toDOM(node) {
					return [
						'div',
						{
							'data-query-block': 'true',
							'data-cell-id': node.attrs.cellId,
							'data-cell-type': node.attrs.cellType
						}
					];
				}
			},
			notebookPage: {
				atom: true,
				group: 'block',
				defining: true,
				attrs: {
					title: { default: 'Untitled' },
					pageId: { default: null },
					nodeId: { default: null }
				},
				parseDOM: [{ tag: 'div[data-notebook-page]' }],
				toDOM(node) {
					return [
						'div',
						{
							'data-notebook-page': 'true',
							'data-title': node.attrs.title,
							'data-page-id': node.attrs.pageId ?? ''
						}
					];
				}
			}
		})
	);
	cachedSchema = new Schema({
		nodes,
		marks: base.spec.marks
			.append({
				strike: {
					parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
					toDOM: () => ['s', 0] as const
				}
			})
			.append({
				underline: {
					parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
					toDOM: () => ['u', 0] as const
				}
			})
			.append({
				highlight: {
					parseDOM: [{ tag: 'mark' }],
					toDOM: () => ['mark', 0] as const
				}
			})
	});
	return cachedSchema;
}

function getMarkdownSerializer(): MarkdownSerializer {
	const baseNodes = defaultMarkdownSerializer.nodes as Record<
		string,
		(state: unknown, node: PMNode, parent: PMNode, index: number) => void
	>;
	return new MarkdownSerializer(
		{
			...baseNodes,
			markdocBlock(state, node) {
				const s = state as { write: (t: string) => void; closeBlock: (n: PMNode) => void };
				s.write(String(node.attrs.source ?? '').trimEnd());
				s.closeBlock(node);
			},
			markdocWidget() {
				/* handled by custom serializer */
			},
			markdocContainer() {
				/* handled by custom serializer */
			},
			markdocExpression() {
				/* handled by custom serializer */
			},
			queryBlock() {
				/* rendered via node view */
			},
			notebookPage(state, node) {
				const s = state as { write: (t: string) => void; closeBlock: (n: PMNode) => void };
				const title = String(node.attrs.title ?? 'Untitled');
				s.write(`# ${title}`);
				s.closeBlock(node);
			}
		},
		{
			...defaultMarkdownSerializer.marks,
			strike: {
				open: '~~',
				close: '~~',
				mixable: true,
				expelEnclosingWhitespace: true
			},
			underline: {
				open: '<u>',
				close: '</u>',
				mixable: true
			},
			highlight: {
				open: '==',
				close: '==',
				mixable: true,
				expelEnclosingWhitespace: true
			}
		}
	);
}

const PM_TO_TIPTAP_NODE: Record<string, string> = {
	bullet_list: 'bulletList',
	ordered_list: 'orderedList',
	list_item: 'listItem',
	code_block: 'codeBlock',
	hard_break: 'hardBreak',
	horizontal_rule: 'horizontalRule',
	task_list: 'taskList',
	task_item: 'taskItem'
};

const TIPTAP_TO_PM_NODE: Record<string, string> = Object.fromEntries(
	Object.entries(PM_TO_TIPTAP_NODE).map(([pm, tip]) => [tip, pm])
);

const PM_TO_TIPTAP_MARK: Record<string, string> = {
	strong: 'bold',
	em: 'italic',
	underline: 'underline',
	strike: 'strike',
	code: 'code',
	link: 'link',
	highlight: 'highlight'
};

const TIPTAP_TO_PM_MARK: Record<string, string> = Object.fromEntries(
	Object.entries(PM_TO_TIPTAP_MARK).map(([pm, tip]) => [tip, pm])
);

function pmNodeJsonToTiptap(node: PMNodeJSON): PMNodeJSON {
	const type = PM_TO_TIPTAP_NODE[node.type] ?? node.type;
	const marks = node.marks?.map((m) => ({
		...m,
		type: PM_TO_TIPTAP_MARK[m.type] ?? m.type
	}));
	const content = node.content?.map(pmNodeJsonToTiptap);
	return { ...node, type, ...(marks ? { marks } : {}), ...(content ? { content } : {}) };
}

export function tiptapNodeJsonToPm(node: PMNodeJSON): PMNodeJSON {
	const type = TIPTAP_TO_PM_NODE[node.type] ?? node.type;
	const marks = node.marks?.map((m) => ({
		...m,
		type: TIPTAP_TO_PM_MARK[m.type] ?? m.type
	}));
	const content = node.content?.map(tiptapNodeJsonToPm);
	return { ...node, type, ...(marks ? { marks } : {}), ...(content ? { content } : {}) };
}

const MARKDOC_EXPR_RE = /\{%\s*[^%]+?\s*%\}/g;
// A bare `$cell.field` reference outside `{% %}` — Lunapad's Markdoc pipeline resolves
// these directly in prose (see interpolateBareVarsInProse in markdoc-interp.ts), so the
// editor should turn them into the same live/editable chip as an explicit `{% %}` ref.
// Require at least one dot segment to avoid false positives on stray `$word` mentions.
const BARE_VAR_RE = /\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g;
const MARKDOC_EXPR_OR_BARE_VAR_RE = new RegExp(
	`(?:${MARKDOC_EXPR_RE.source})|(?:${BARE_VAR_RE.source})`,
	'g'
);

function textLikelyHasExpression(text: string): boolean {
	return text.includes('{%') || /\$[A-Za-z_]\w*\./.test(text);
}

function splitTextWithExpressions(text: string, marks?: PMMarkJSON[]): PMNodeJSON[] {
	const nodes: PMNodeJSON[] = [];
	let last = 0;
	let match: RegExpExecArray | null;
	const re = new RegExp(MARKDOC_EXPR_OR_BARE_VAR_RE.source, 'g');
	while ((match = re.exec(text)) !== null) {
		if (match.index > last) {
			nodes.push({
				type: 'text',
				text: text.slice(last, match.index),
				...(marks ? { marks } : {})
			});
		}
		nodes.push({
			type: 'markdocExpression',
			attrs: { source: match[0] },
			...(marks ? { marks } : {})
		});
		last = match.index + match[0].length;
	}
	if (last < text.length) {
		nodes.push({ type: 'text', text: text.slice(last), ...(marks ? { marks } : {}) });
	}
	return nodes.length ? nodes : [{ type: 'text', text, ...(marks ? { marks } : {}) }];
}

function injectExpressionsInNodes(nodes: PMNodeJSON[]): PMNodeJSON[] {
	return nodes.map((node) => {
		if (node.content?.length) {
			const content = node.content.flatMap((child) => {
				if (child.type === 'text' && child.text && textLikelyHasExpression(child.text)) {
					return splitTextWithExpressions(child.text, child.marks);
				}
				return [injectExpressionsInNodes([child])[0]!];
			});
			return { ...node, content };
		}
		return node;
	});
}

const TASK_ITEM_PREFIX_RE = /^\[([ xX])\]\s?(.*)$/s;

function getTaskItemFromListItem(
	listItem: PMNodeJSON
): { checked: boolean; content: PMNodeJSON[] } | null {
	const para = listItem.content?.[0];
	if (para?.type !== 'paragraph') return null;
	const first = para.content?.[0];
	if (first?.type !== 'text' || typeof first.text !== 'string') return null;
	const match = first.text.match(TASK_ITEM_PREFIX_RE);
	if (!match) return null;

	const checked = match[1]!.toLowerCase() === 'x';
	const rest = match[2] ?? '';
	const newContent = (listItem.content ?? []).map((block, blockIndex) => {
		if (blockIndex !== 0 || block.type !== 'paragraph') return block;
		const children = [...(block.content ?? [])];
		if (rest.length) {
			children[0] = { ...children[0]!, type: 'text', text: rest };
		} else {
			children.shift();
		}
		if (!children.length) children.push({ type: 'text', text: '' });
		return { ...block, content: children };
	});

	return { checked, content: newContent };
}

function convertTaskListsInPmNode(node: PMNodeJSON): PMNodeJSON {
	const content = node.content?.map(convertTaskListsInPmNode);

	if (node.type === 'bullet_list' && content?.length) {
		const tasks = content.map((item) =>
			item.type === 'list_item' ? getTaskItemFromListItem(item) : null
		);
		if (tasks.length > 0 && tasks.every((t) => t !== null)) {
			return {
				type: 'task_list',
				content: content.map((item, i) => ({
					type: 'task_item',
					attrs: { checked: tasks[i]!.checked },
					content: tasks[i]!.content
				}))
			};
		}
	}

	return { ...node, ...(content ? { content } : {}) };
}

/** GFM table delimiter row, e.g. `| --- | :--: |`. Requires a pipe so we never
 * mistake a setext underline or horizontal rule (`---`) for a table. */
function isTableDelimiterRow(line: string): boolean {
	const t = line.trim();
	if (!t.includes('|') || !t.includes('-')) return false;
	return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t);
}

function looksLikeTableRow(line: string): boolean {
	return line.includes('|');
}

/** Split a GFM table row into trimmed cell strings, honoring escaped pipes (`\|`)
 * and optional leading/trailing pipes. */
function splitTableRow(line: string): string[] {
	let t = line.trim();
	if (t.startsWith('|')) t = t.slice(1);
	if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
	const cells: string[] = [];
	let cur = '';
	for (let i = 0; i < t.length; i++) {
		if (t[i] === '\\' && t[i + 1] === '|') {
			cur += '|';
			i++;
			continue;
		}
		if (t[i] === '|') {
			cells.push(cur);
			cur = '';
			continue;
		}
		cur += t[i];
	}
	cells.push(cur);
	return cells.map((c) => c.trim());
}

/** Parse a single line of inline markdown into TipTap inline nodes (keeps marks
 * like bold/italic/links inside table cells). */
function parseInlineToNodes(text: string): PMNodeJSON[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const parsed = defaultMarkdownParser.parse(trimmed);
	const first = parsed.content.content[0];
	if (!first) return [];
	const json = pmNodeJsonToTiptap(first.toJSON() as PMNodeJSON);
	return json.content ?? [];
}

/** Build a TipTap `table` node from GFM table source lines (header, delimiter,
 * body rows). The first row is emitted as header cells so it round-trips through
 * the custom table serializer (which always re-adds the delimiter after row 0). */
function buildTableNode(lines: string[]): PMNodeJSON | null {
	if (lines.length < 2) return null;
	const header = splitTableRow(lines[0]!);
	const width = header.length;
	const makeCell = (text: string, isHeader: boolean): PMNodeJSON => {
		const inline = parseInlineToNodes(text);
		return {
			type: isHeader ? 'tableHeader' : 'tableCell',
			attrs: { colspan: 1, rowspan: 1, colwidth: null },
			content: [inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }]
		};
	};
	const rows: PMNodeJSON[] = [{ type: 'tableRow', content: header.map((c) => makeCell(c, true)) }];
	for (const line of lines.slice(2)) {
		const cells = splitTableRow(line);
		const rowContent: PMNodeJSON[] = [];
		for (let i = 0; i < width; i++) rowContent.push(makeCell(cells[i] ?? '', false));
		rows.push({ type: 'tableRow', content: rowContent });
	}
	return { type: 'table', content: rows };
}

type NarrativeSegment = { kind: 'text' | 'table'; lines: string[] };

/** Split narrative source into contiguous prose runs and GFM table blocks so we
 * can hand tables to a dedicated builder (prosemirror-markdown has no table
 * support) while leaving everything else to the default markdown parser. */
function splitNarrativeSegments(source: string): NarrativeSegment[] {
	const lines = source.split('\n');
	const segments: NarrativeSegment[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		const next = lines[i + 1];
		if (
			looksLikeTableRow(line) &&
			!isTableDelimiterRow(line) &&
			next !== undefined &&
			isTableDelimiterRow(next)
		) {
			const tableLines = [line, next];
			let j = i + 2;
			while (j < lines.length) {
				const rowLine = lines[j]!;
				if (rowLine.trim() === '') {
					// Markdoc often splits GFM tables at blank lines; skip gaps when more rows follow.
					let k = j + 1;
					while (k < lines.length && lines[k]!.trim() === '') k++;
					if (k < lines.length && looksLikeTableRow(lines[k]!)) {
						j = k;
						continue;
					}
					break;
				}
				if (!looksLikeTableRow(rowLine)) break;
				tableLines.push(rowLine);
				j++;
			}
			segments.push({ kind: 'table', lines: tableLines });
			i = j;
			continue;
		}
		const lastSeg = segments[segments.length - 1];
		if (lastSeg && lastSeg.kind === 'text') {
			lastSeg.lines.push(line);
		} else {
			segments.push({ kind: 'text', lines: [line] });
		}
		i++;
	}
	return segments;
}

/** True when every non-empty line looks like a GFM table row (contains `|`). */
function isTableOnlyProse(source: string): boolean {
	const nonEmpty = source.split('\n').filter((l) => l.trim() !== '');
	return nonEmpty.length > 0 && nonEmpty.every((l) => looksLikeTableRow(l));
}

/** Markdoc splits GFM tables at blank lines into separate prose blocks. Merge a header
 * fragment (ending in a delimiter row) with following body-row fragments. */
function coalesceTableProseBlocks(blocks: VisualBlock[]): VisualBlock[] {
	const merged: VisualBlock[] = [];
	for (const block of blocks) {
		if (block.kind !== 'prose' || !merged.length) {
			merged.push(block);
			continue;
		}
		const prev = merged[merged.length - 1]!;
		if (prev.kind !== 'prose') {
			merged.push(block);
			continue;
		}
		const prevLines = prev.source.split('\n').filter((l) => l.trim() !== '');
		const prevHasDelimiter = prevLines.some((l) => isTableDelimiterRow(l));
		if (prevHasDelimiter && isTableOnlyProse(prev.source) && isTableOnlyProse(block.source)) {
			merged[merged.length - 1] = {
				...prev,
				source: `${prev.source}\n\n${block.source}`
			};
			continue;
		}
		merged.push(block);
	}
	return merged;
}

function narrativeNodesFromSource(source: string, schema: Schema): PMNodeJSON[] {
	const trimmed = source.trimEnd();
	if (!trimmed) return [];
	const segments = splitNarrativeSegments(trimmed);
	const nodes: PMNodeJSON[] = [];
	for (const segment of segments) {
		if (segment.kind === 'table') {
			const table = buildTableNode(segment.lines);
			if (table) nodes.push(table);
			continue;
		}
		const text = segment.lines.join('\n').trim();
		if (!text) continue;
		const parsed = defaultMarkdownParser.parse(text);
		for (const child of parsed.content.content) {
			const json = convertTaskListsInPmNode(child.toJSON() as PMNodeJSON);
			nodes.push(pmNodeJsonToTiptap(json));
		}
	}
	return injectExpressionsInNodes(nodes);
}

function narrativeNodesToMarkdown(nodes: PMNodeJSON[], schema: Schema): string {
	if (!nodes.length) return '';
	const fragment = nodes.map((n) => schema.nodeFromJSON(tiptapNodeJsonToPm(n)));
	const doc = schema.nodes.doc.create(null, fragment);
	return getMarkdownSerializer().serialize(doc).trimEnd();
}

function parseAttrsJson(raw: unknown): Record<string, unknown> {
	return parseWidgetAttrsJson(raw);
}

function blockToPmNodes(block: VisualBlock, schema: Schema): PMNodeJSON[] {
	if (isNarrativeKind(block.kind)) {
		return narrativeNodesFromSource(block.source, schema);
	}
	if (block.kind === 'fence') {
		return [{ type: 'markdocBlock', attrs: { source: block.source } }];
	}

	const parsed = parseBlockWidget(block);
	if (!parsed) {
		return [{ type: 'markdocBlock', attrs: { source: block.source } }];
	}

	if (!isStructuredMarkdocContainerTag(parsed.tagName, { selfClosing: parsed.selfClosing })) {
		return [
			{
				type: 'markdocWidget',
				attrs: {
					tagName: parsed.tagName,
					attrsJson: markdocAttrsToJson(parsed.attrs),
					selfClosing: parsed.selfClosing
				}
			}
		];
	}

	const childBlocks = parseVisualBlocks(parsed.bodySource);
	let content: PMNodeJSON[];

	if (parsed.tagName === 'mermaid') {
		const body = parsed.bodySource.trimEnd();
		content = body
			? [
					{
						type: 'codeBlock',
						attrs: { language: 'mermaid' },
						content: [{ type: 'text', text: body }]
					}
				]
			: [{ type: 'paragraph' }];
	} else {
		content = childBlocks.flatMap((b) => blockToPmNodes(b, schema));
		if (!content.length) content.push({ type: 'paragraph' });
	}

	const containerAttrs =
		parsed.tagName === 'if' && parsed.condition !== undefined
			? { ...parsed.attrs, condition: parsed.condition }
			: parsed.attrs;

	return [
		{
			type: 'markdocContainer',
			attrs: {
				tagName: parsed.tagName,
				attrsJson: markdocAttrsToJson(containerAttrs)
			},
			content
		}
	];
}

function serializeTextNodeWithMarks(node: PMNodeJSON, schema: Schema): string {
	if (node.type !== 'text') return serializeTiptapNode(node, schema);
	// The markdown serializer trims edge whitespace, but for an inline segment that
	// sits next to a markdoc expression (`… contains {% $x %} …`) the leading/trailing
	// space is significant — dropping it glues words to the resolved value. Peel the
	// edge spaces off, serialize the core (so marks like **bold** still round-trip),
	// then re-attach the spaces outside the mark delimiters.
	const raw = node.text ?? '';
	const leading = raw.match(/^[ \t]+/)?.[0] ?? '';
	const trailing = raw.match(/[ \t]+$/)?.[0] ?? '';
	const core = raw.slice(leading.length, raw.length - trailing.length);
	if (!core) return raw;
	const para = schema.nodes.doc.create(null, [
		schema.nodeFromJSON(
			tiptapNodeJsonToPm({
				type: 'paragraph',
				content: [{ ...node, text: core }]
			})
		)
	]);
	return leading + getMarkdownSerializer().serialize(para).trimEnd() + trailing;
}

const MARK_DELIMITERS: Record<string, [string, string]> = {
	bold: ['**', '**'],
	strong: ['**', '**'],
	italic: ['*', '*'],
	em: ['*', '*'],
	strike: ['~~', '~~'],
	code: ['`', '`']
};

/** Wrap a markdoc expression's raw source in markdown delimiters for its inline marks,
 * so `**{% $x %}**` survives the round-trip (ProseMirror carries marks on the atom node). */
function wrapSourceWithMarks(source: string, marks?: PMMarkJSON[]): string {
	if (!marks?.length) return source;
	let out = source;
	for (const mark of marks) {
		const delims = MARK_DELIMITERS[mark.type];
		if (delims) out = `${delims[0]}${out}${delims[1]}`;
	}
	return out;
}

function serializeInlineChildren(nodes: PMNodeJSON[] | undefined, schema: Schema): string {
	return (nodes ?? [])
		.map((child) => {
			if (child.type === 'markdocExpression')
				return wrapSourceWithMarks(String(child.attrs?.source ?? ''), child.marks);
			if (child.type === 'text') return serializeTextNodeWithMarks(child, schema);
			return serializeTiptapNode(child, schema);
		})
		.join('');
}

function nodeHasMarkdocExpressions(node: PMNodeJSON): boolean {
	if (node.type === 'markdocExpression') return true;
	return (node.content ?? []).some(nodeHasMarkdocExpressions);
}

/** Concatenated plain text from a paragraph node's text children. */
function paragraphPlainText(node: PMNodeJSON): string {
	if (node.type !== 'paragraph') return '';
	return (node.content ?? [])
		.filter((c) => c.type === 'text')
		.map((c) => c.text ?? '')
		.join('');
}

/** View-only empty line or lone "/" from an opened-then-dismissed slash menu. */
export function isAffordanceParagraph(node: PMNodeJSON): boolean {
	if (node.type !== 'paragraph') return false;
	const t = paragraphPlainText(node).trim();
	return t === '' || t === '/';
}

function listItemPlainText(item: PMNodeJSON): string {
	if (item.type !== 'listItem') return '';
	return (item.content ?? [])
		.filter((c) => c.type === 'paragraph')
		.map((c) => paragraphPlainText(c))
		.join('');
}

function isEmptyListItem(item: PMNodeJSON): boolean {
	return item.type === 'listItem' && !listItemPlainText(item).trim();
}

/** Remove a trailing "/" typed at the end of the last inline text segment. */
function stripTrailingSlashFromParagraph(node: PMNodeJSON): PMNodeJSON {
	if (node.type !== 'paragraph') return node;
	const content = [...(node.content ?? [])];
	for (let i = content.length - 1; i >= 0; i--) {
		const child = content[i]!;
		if (child.type !== 'text' || !child.text) continue;
		if (!child.text.endsWith('/')) return node;
		const trimmed = child.text.slice(0, -1);
		if (trimmed) content[i] = { ...child, text: trimmed };
		else content.splice(i, 1);
		return content.length ? { ...node, content } : { type: 'paragraph' };
	}
	return node;
}

/** Remove a leading "/" left from slash-menu filter text (not markdoc). */
function stripLeadingSlashFromParagraph(node: PMNodeJSON): PMNodeJSON {
	if (node.type !== 'paragraph') return node;
	const content = [...(node.content ?? [])];
	const first = content[0];
	if (first?.type !== 'text' || !first.text?.startsWith('/')) return node;
	if (first.text.startsWith('{%') || first.text.startsWith('/%')) return node;
	const rest = first.text.slice(1);
	if (!rest) return node;
	content[0] = { ...first, text: rest };
	return { ...node, content };
}

function stripSlashResidueFromListItem(item: PMNodeJSON): PMNodeJSON {
	if (item.type !== 'listItem') return item;
	let content = (item.content ?? []).map((p) =>
		p.type === 'paragraph' ? stripLeadingSlashFromParagraph(stripTrailingSlashFromParagraph(p)) : p
	);
	content = content.filter((p) => !(p.type === 'paragraph' && isAffordanceParagraph(p)));
	return content.length ? { ...item, content } : item;
}

function stripSlashResidueFromList(node: PMNodeJSON): PMNodeJSON {
	if (node.type !== 'bulletList' && node.type !== 'orderedList' && node.type !== 'taskList') {
		return node;
	}
	let items = (node.content ?? []).map(stripSlashResidueFromListItem);
	while (items.length && isEmptyListItem(items[items.length - 1]!)) {
		items = items.slice(0, -1);
	}
	return { ...node, content: items };
}

/** A paragraph whose entire text is a lone "/" — the drag-gutter "+" affordance or
 * an opened-then-dismissed slash menu on an empty line. Never legitimate content. */
function isLoneSlashParagraph(node: PMNodeJSON): boolean {
	return node.type === 'paragraph' && paragraphPlainText(node).trim() === '/';
}

/** Strip view-only slash affordance nodes before persisting editor state to markdown. */
export function stripEditorAffordanceNodes(nodes: PMNodeJSON[]): PMNodeJSON[] {
	// Lone "/" paragraphs are junk wherever they appear (not just at boundaries):
	// the "+" gutter drops one after the current block, which can be mid-document.
	let result = nodes.filter((n) => !isLoneSlashParagraph(n));

	while (result.length && isAffordanceParagraph(result[result.length - 1]!)) {
		result.pop();
	}
	while (result.length && isAffordanceParagraph(result[0]!)) {
		result.shift();
	}

	if (result.length) {
		const lastIdx = result.length - 1;
		let last = result[lastIdx]!;
		if (last.type === 'paragraph') {
			last = stripTrailingSlashFromParagraph(last);
			if (isAffordanceParagraph(last)) {
				result.pop();
			} else {
				result[lastIdx] = last;
			}
		} else if (
			last.type === 'bulletList' ||
			last.type === 'orderedList' ||
			last.type === 'taskList'
		) {
			last = stripSlashResidueFromList(last);
			const items = last.content ?? [];
			if (!items.length) result.pop();
			else result[lastIdx] = last;
		}
	}

	return result;
}

const PROSE_BLOCK_TYPES = new Set([
	'paragraph',
	'heading',
	'blockquote',
	'bulletList',
	'orderedList',
	'taskList',
	'codeBlock',
	'table'
]);

function joinContainerBody(children: PMNodeJSON[], schema: Schema): string {
	const parts = children.map((child) => serializeTiptapNode(child, schema)).filter(Boolean);
	if (parts.length <= 1) return parts.join('');
	let body = parts[0]!;
	for (let i = 1; i < parts.length; i++) {
		const prev = children[i - 1]!;
		const next = children[i]!;
		const sep =
			PROSE_BLOCK_TYPES.has(prev.type) && PROSE_BLOCK_TYPES.has(next.type) ? '\n\n' : '\n';
		body += `${sep}${parts[i]}`;
	}
	return body;
}

function serializeTiptapNode(node: PMNodeJSON, schema: Schema): string {
	if (node.type === 'markdocExpression') {
		return String(node.attrs?.source ?? '');
	}
	if (node.type === 'paragraph' && nodeHasMarkdocExpressions(node)) {
		return serializeInlineChildren(node.content, schema);
	}
	if (node.type === 'heading' && nodeHasMarkdocExpressions(node)) {
		const level = Number(node.attrs?.level ?? 1);
		const hashes = '#'.repeat(level);
		return `${hashes} ${serializeInlineChildren(node.content, schema)}`;
	}
	if (node.type === 'markdocBlock') {
		return String(node.attrs?.source ?? '').trimEnd();
	}
	if (node.type === 'markdocWidget') {
		const tagName = String(node.attrs?.tagName ?? 'metric');
		const attrs = parseAttrsJson(node.attrs?.attrsJson);
		const selfClosing = Boolean(node.attrs?.selfClosing ?? true);
		return serializeMarkdocTag(tagName, attrs, { selfClosing });
	}
	if (node.type === 'markdocContainer') {
		const tagName = String(node.attrs?.tagName ?? 'callout');
		const attrs = parseAttrsJson(node.attrs?.attrsJson);
		let body: string;
		if (
			tagName === 'mermaid' &&
			node.content?.length === 1 &&
			node.content[0].type === 'codeBlock'
		) {
			body = (node.content[0].content ?? []).map((c) => c.text ?? '').join('');
		} else {
			body = joinContainerBody(node.content ?? [], schema);
		}
		return serializeMarkdocTag(tagName, attrs, { body });
	}
	if (node.type === 'taskList') {
		return (node.content ?? [])
			.map((item) => serializeTiptapNode(item, schema))
			.filter(Boolean)
			.join('\n');
	}
	if (node.type === 'taskItem') {
		const checked = node.attrs?.checked ? 'x' : ' ';
		const inner = (node.content ?? [])
			.map((child) => serializeTiptapNode(child, schema))
			.join('')
			.trim();
		return `- [${checked}] ${inner}`;
	}
	if (node.type === 'table') {
		const rows = node.content ?? [];
		const lines: string[] = [];
		for (let i = 0; i < rows.length; i++) {
			const cells = (rows[i].content ?? []).map((cell) => {
				const text = (cell.content ?? [])
					.map((c) => serializeTiptapNode(c, schema))
					.join('')
					.trim();
				return text.replace(/\|/g, '\\|');
			});
			lines.push(`| ${cells.join(' | ')} |`);
			if (i === 0) {
				lines.push(`| ${cells.map(() => '---').join(' | ')} |`);
			}
		}
		return lines.join('\n');
	}
	if (node.type === 'tableRow' || node.type === 'tableHeader' || node.type === 'tableCell') {
		return (node.content ?? []).map((c) => serializeTiptapNode(c, schema)).join('');
	}
	if (node.type === 'image') {
		const src = String(node.attrs?.src ?? '');
		const alt = String(node.attrs?.alt ?? '');
		const title = node.attrs?.title ? ` "${node.attrs.title}"` : '';
		return `![${alt}](${src}${title})`;
	}
	if (node.type === 'horizontalRule') {
		return '---';
	}
	return narrativeNodesToMarkdown([node], schema);
}

export function serializePmNodeToMarkdown(node: PMNode | PMNodeJSON): string {
	if ('toJSON' in node) {
		return serializeTiptapNode(node.toJSON() as PMNodeJSON, node.type.schema).trimEnd();
	}
	const schema = getMarkdocPmSchema();
	return serializeTiptapNode(node, schema).trimEnd();
}

/** Parse a markdown(Markdoc) cell into a ProseMirror JSON document + optional frontmatter. */
export function markdownToPmDocument(markdown: string): MarkdocPmDocument {
	const { frontmatter, body } = splitFrontmatter(markdown);
	const blocks = coalesceTableProseBlocks(parseVisualBlocks(body));
	const schema = getMarkdocPmSchema();
	const content: PMNodeJSON[] = [];

	for (const block of blocks) {
		if (isNarrativeKind(block.kind)) {
			content.push(...narrativeNodesFromSource(block.source, schema));
		} else if (isMarkdocAtomKind(block.kind)) {
			content.push(...blockToPmNodes(block, schema));
		}
	}

	if (!content.length) {
		content.push({ type: 'paragraph' });
	}

	return { frontmatter, doc: { type: 'doc', content } };
}

/** Serialize a ProseMirror JSON document back to markdown(Markdoc). */
export function pmDocumentToMarkdown(pm: MarkdocPmDocument): string {
	const schema = getMarkdocPmSchema();
	const parts: string[] = [];
	const content = stripEditorAffordanceNodes(pm.doc.content ?? []);

	for (const nodeJson of content) {
		const part = serializeTiptapNode(nodeJson, schema);
		if (part) parts.push(part);
	}

	const body = parts.filter(Boolean).join('\n\n');
	const serialized = pm.frontmatter ? `${pm.frontmatter}\n\n${body}` : body;
	return serialized.replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Convenience: markdown → PM JSON doc only (no frontmatter wrapper). */
export function markdownToDoc(markdown: string): PMDocJSON {
	return markdownToPmDocument(markdown).doc;
}

/** Convenience: PM JSON doc → markdown (frontmatter must be passed separately). */
export function docToMarkdown(doc: PMDocJSON, frontmatter = ''): string {
	return pmDocumentToMarkdown({ frontmatter, doc });
}

export function normalizeMarkdocMarkdown(s: string): string {
	return s
		.replace(/\r\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/^([ \t]*)[-*] /gm, '$1* ')
		.trim();
}

/** Returns whether markdown survives a PM round-trip without semantic loss. */
export function markdocPmRoundTripLossy(markdown: string): { lossy: boolean; reasons: string[] } {
	const reasons: string[] = [];
	if (!markdown.trim()) return { lossy: false, reasons };

	try {
		const pm = markdownToPmDocument(markdown);
		const roundTripped = pmDocumentToMarkdown(pm);
		if (normalizeMarkdocMarkdown(roundTripped) !== normalizeMarkdocMarkdown(markdown)) {
			reasons.push('Round-trip markdown differs from source');
		}
	} catch (e) {
		reasons.push(e instanceof Error ? e.message : 'Round-trip failed');
	}

	return { lossy: reasons.length > 0, reasons };
}
