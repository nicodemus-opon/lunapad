import { Schema, type Node as PMNode } from 'prosemirror-model';
import {
	defaultMarkdownParser,
	defaultMarkdownSerializer,
	MarkdownSerializer
} from 'prosemirror-markdown';
import { parseVisualBlocks, splitFrontmatter, type VisualBlockKind } from './markdoc-ast';

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

/** ProseMirror schema: standard markdown nodes + atomic `markdocBlock` for {% tags %}/fences. */
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
			}
		}),
		marks: base.spec.marks
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
			}
		},
		defaultMarkdownSerializer.marks
	);
}

const PM_TO_TIPTAP_NODE: Record<string, string> = {
	bullet_list: 'bulletList',
	ordered_list: 'orderedList',
	list_item: 'listItem',
	code_block: 'codeBlock',
	hard_break: 'hardBreak',
	horizontal_rule: 'horizontalRule'
};

const TIPTAP_TO_PM_NODE: Record<string, string> = Object.fromEntries(
	Object.entries(PM_TO_TIPTAP_NODE).map(([pm, tip]) => [tip, pm])
);

const PM_TO_TIPTAP_MARK: Record<string, string> = {
	strong: 'bold',
	em: 'italic'
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

function narrativeNodesFromSource(source: string, schema: Schema): PMNodeJSON[] {
	const trimmed = source.trimEnd();
	if (!trimmed) return [];
	const parsed = defaultMarkdownParser.parse(trimmed);
	return parsed.content.content.map((child) => pmNodeJsonToTiptap(child.toJSON() as PMNodeJSON));
}

function narrativeNodesToMarkdown(nodes: PMNodeJSON[], schema: Schema): string {
	if (!nodes.length) return '';
	const fragment = nodes.map((n) => schema.nodeFromJSON(n));
	const doc = schema.nodes.doc.create(null, fragment);
	return getMarkdownSerializer().serialize(doc).trimEnd();
}

/** Parse a markdown(Markdoc) cell into a ProseMirror JSON document + optional frontmatter. */
export function markdownToPmDocument(markdown: string): MarkdocPmDocument {
	const { frontmatter, body } = splitFrontmatter(markdown);
	const blocks = parseVisualBlocks(body);
	const content: PMNodeJSON[] = [];

	for (const block of blocks) {
		if (isNarrativeKind(block.kind)) {
			content.push(...narrativeNodesFromSource(block.source, getMarkdocPmSchema()));
		} else if (isMarkdocAtomKind(block.kind)) {
			content.push({ type: 'markdocBlock', attrs: { source: block.source } });
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
		if (nodeJson.type === 'markdocBlock') {
			const source = String(nodeJson.attrs?.source ?? '').trimEnd();
			if (source) parts.push(source);
		} else {
			parts.push(narrativeNodesToMarkdown([tiptapNodeJsonToPm(nodeJson)], schema));
		}
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
