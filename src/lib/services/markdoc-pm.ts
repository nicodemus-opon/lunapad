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
	type VisualBlock,
	type VisualBlockKind
} from './markdoc-ast';
import { isMarkdocContainerTag } from '../components/markdown/visual/widget-registry';

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
	content?: PMNodeJSON[];
}

export interface MarkdocPmDocument {
	frontmatter: string;
	doc: PMDocJSON;
}

function isNarrativeKind(kind: VisualBlockKind): boolean {
	return kind === 'prose' || kind === 'heading';
}

function isMarkdocAtomKind(kind: VisualBlockKind): boolean {
	return kind === 'widget' || kind === 'container' || kind === 'fence';
}

let cachedSchema: Schema | null = null;

/** ProseMirror schema: standard markdown nodes + Markdoc widget/container atoms. */
export function getMarkdocPmSchema(): Schema {
	if (cachedSchema) return cachedSchema;
	const base = defaultMarkdownParser.schema;
	cachedSchema = new Schema({
		nodes: base.spec.nodes.append({
			markdocBlock: {
				atom: true,
				group: 'block',
				defining: true,
				isolating: true,
				attrs: { source: { default: '' } },
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
					selfClosing: { default: true }
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
					attrsJson: { default: '{}' }
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
				attrs: { source: { default: '' } },
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
					pinned: { default: false }
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
					pageId: { default: null }
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
		}),
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

function tiptapNodeJsonToPm(node: PMNodeJSON): PMNodeJSON {
	const type = TIPTAP_TO_PM_NODE[node.type] ?? node.type;
	const marks = node.marks?.map((m) => ({
		...m,
		type: TIPTAP_TO_PM_MARK[m.type] ?? m.type
	}));
	const content = node.content?.map(tiptapNodeJsonToPm);
	return { ...node, type, ...(marks ? { marks } : {}), ...(content ? { content } : {}) };
}

const MARKDOC_EXPR_RE = /\{%\s*[^%]+?\s*%\}/g;

function splitTextWithExpressions(
	text: string,
	marks?: PMMarkJSON[]
): PMNodeJSON[] {
	const nodes: PMNodeJSON[] = [];
	let last = 0;
	let match: RegExpExecArray | null;
	const re = new RegExp(MARKDOC_EXPR_RE.source, 'g');
	while ((match = re.exec(text)) !== null) {
		if (match.index > last) {
			nodes.push({ type: 'text', text: text.slice(last, match.index), ...(marks ? { marks } : {}) });
		}
		nodes.push({ type: 'markdocExpression', attrs: { source: match[0] }, ...(marks ? { marks } : {}) });
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
				if (child.type === 'text' && child.text?.includes('{%')) {
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

function getTaskItemFromListItem(listItem: PMNodeJSON): { checked: boolean; content: PMNodeJSON[] } | null {
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

function narrativeNodesFromSource(source: string, schema: Schema): PMNodeJSON[] {
	const trimmed = source.trimEnd();
	if (!trimmed) return [];
	const parsed = defaultMarkdownParser.parse(trimmed);
	const nodes = parsed.content.content.map((child) => {
		const json = convertTaskListsInPmNode(child.toJSON() as PMNodeJSON);
		return pmNodeJsonToTiptap(json);
	});
	return injectExpressionsInNodes(nodes);
}

function narrativeNodesToMarkdown(nodes: PMNodeJSON[], schema: Schema): string {
	if (!nodes.length) return '';
	const fragment = nodes.map((n) => schema.nodeFromJSON(tiptapNodeJsonToPm(n)));
	const doc = schema.nodes.doc.create(null, fragment);
	return getMarkdownSerializer().serialize(doc).trimEnd();
}

function parseAttrsJson(raw: unknown): Record<string, unknown> {
	if (typeof raw !== 'string' || !raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
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

	if (parsed.selfClosing || !isMarkdocContainerTag(parsed.tagName)) {
		return [
			{
				type: 'markdocWidget',
				attrs: {
					tagName: parsed.tagName,
					attrsJson: JSON.stringify(parsed.attrs),
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

	return [
		{
			type: 'markdocContainer',
			attrs: {
				tagName: parsed.tagName,
				attrsJson: JSON.stringify(parsed.attrs)
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
		if (tagName === 'mermaid' && node.content?.length === 1 && node.content[0].type === 'codeBlock') {
			body = (node.content[0].content ?? [])
				.map((c) => c.text ?? '')
				.join('');
		} else {
			body = (node.content ?? [])
				.map((child) => serializeTiptapNode(child, schema))
				.filter(Boolean)
				.join('\n\n');
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

/** Parse a markdown(Markdoc) cell into a ProseMirror JSON document + optional frontmatter. */
export function markdownToPmDocument(markdown: string): MarkdocPmDocument {
	const { frontmatter, body } = splitFrontmatter(markdown);
	const blocks = parseVisualBlocks(body);
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

	for (const nodeJson of pm.doc.content ?? []) {
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
