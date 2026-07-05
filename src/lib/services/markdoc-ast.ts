import Markdoc from '@markdoc/markdoc';
import { CUSTOM_MARKDOC_TAGS, type MarkdocDiagnostic } from './markdoc-interp';
import { isSelfClosingTag } from './markdoc-catalog';
import { isStructuredMarkdocContainerTag } from './markdoc-tag-registry';

export type VisualBlockKind = 'prose' | 'widget' | 'container' | 'fence' | 'heading';

export interface VisualBlock {
	id: string;
	kind: VisualBlockKind;
	source: string;
	tagName?: string;
}

export interface ParsedWidgetBlock {
	tagName: string;
	attrs: Record<string, unknown>;
	selfClosing: boolean;
	bodySource: string;
	condition?: string;
}

function blockKindForNode(node: { type: string; tag?: string }): VisualBlockKind {
	if (node.type === 'fence') return 'fence';
	if (node.type === 'heading') return 'heading';
	if (node.type === 'tag' && node.tag) {
		if (isStructuredMarkdocContainerTag(node.tag) || node.tag === 'else') return 'container';
		if ((CUSTOM_MARKDOC_TAGS as readonly string[]).includes(node.tag)) return 'widget';
		return 'container';
	}
	return 'prose';
}

function sliceNodeSource(markdown: string, lines: number[]): string {
	if (!lines.length) return '';
	const start = lines[0];
	const end = lines[lines.length - 1];
	return markdown.split('\n').slice(start, end).join('\n');
}

// Deterministic 32-bit FNV-1a hash → short base36 string. Used to derive stable block
// IDs from block content so that re-parsing the same markdown yields the same IDs.
function hashSource(s: string): string {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}

// Stable, content-derived block ID. Blocks keep the same ID across re-parses (and across
// reordering) as long as their source is unchanged, which is what lets Svelte's keyed
// `{#each}` preserve DOM/selection instead of destroying every block on each keystroke.
// Identical sources are disambiguated by occurrence order via `seen`.
function stableBlockId(source: string, seen: Map<string, number>): string {
	const base = hashSource(source);
	const n = seen.get(base) ?? 0;
	seen.set(base, n + 1);
	return `b_${base}_${n}`;
}

/**
 * Split leading YAML frontmatter (`---\n…\n---`) from the markdown body.
 * Markdoc parks frontmatter on `ast.attributes` rather than in `ast.children`, so
 * the block-based visual editor would otherwise drop it on the first re-serialize.
 * The editor keeps `frontmatter` verbatim and re-prepends it when emitting.
 */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
	const m = markdown.match(/^(---\r?\n[\s\S]*?\r?\n---)[ \t]*(?:\r?\n)*/);
	if (!m) return { frontmatter: '', body: markdown };
	return { frontmatter: m[1], body: markdown.slice(m[0].length) };
}

export function parseVisualBlocks(markdown: string): VisualBlock[] {
	if (!markdown.trim()) return [];
	const ast = Markdoc.parse(markdown);
	const children = (ast as { children?: Array<{ type: string; tag?: string; lines?: number[] }> })
		.children;
	const seen = new Map<string, number>();
	if (!children?.length) {
		const source = markdown.trimEnd();
		return [{ id: stableBlockId(source, seen), kind: 'prose', source }];
	}

	return children.map((node) => {
		const source = sliceNodeSource(markdown, node.lines ?? []);
		return {
			id: stableBlockId(source, seen),
			kind: blockKindForNode(node),
			source,
			tagName: node.type === 'tag' ? node.tag : undefined
		};
	});
}

export function serializeVisualBlocks(blocks: VisualBlock[]): string {
	return blocks
		.map((b) => b.source.trimEnd())
		.filter(Boolean)
		.join('\n\n');
}

export function parseBlockWidget(block: VisualBlock): ParsedWidgetBlock | null {
	if (!block.tagName) return null;
	const ast = Markdoc.parse(block.source);
	const tagNode = findFirstTag(ast);
	if (!tagNode) return null;

	const selfClosing =
		Boolean(tagNode.close?.type === 'self-closing') || isSelfClosingTag(tagNode.tag);
	const attrs = { ...tagNode.attributes } as Record<string, unknown>;
	const condition = tagNode.tag === 'if' ? extractIfCondition(block.source) : undefined;

	let bodySource = '';
	if (!selfClosing && tagNode.lines) {
		const lines = block.source.split('\n');
		const openEnd = tagNode.lines[1] ?? tagNode.lines[0] + 1;
		// Markdoc doesn't populate `close` on parsed container/`if` nodes — it folds the
		// closing tag's line map into `tagNode.lines` as [openStart, openEnd, closeStart,
		// closeEnd]. Falling back to `lines.length` would swallow the `{% /tag %}` line into
		// the body, and re-serializing then emits a second closing tag ("Node 'tag' is
		// missing opening"). Use the recorded close-start line instead.
		const closeStart = tagNode.close?.lines?.[0] ?? tagNode.lines[2] ?? lines.length;
		bodySource = lines.slice(openEnd, closeStart).join('\n');
	}

	return { tagName: tagNode.tag, attrs, selfClosing, bodySource, condition };
}

function extractIfCondition(source: string): string | undefined {
	const firstLine = source.split('\n')[0] ?? '';
	const match = firstLine.match(/^\s*\{%\s*if\s+(.+?)\s*%\}\s*$/);
	return match?.[1]?.trim();
}

function findFirstTag(ast: unknown): {
	tag: string;
	attributes: Record<string, unknown>;
	lines?: number[];
	close?: { type?: string; lines?: number[] };
} | null {
	const walk = (node: unknown): ReturnType<typeof findFirstTag> => {
		if (!node || typeof node !== 'object') return null;
		const n = node as {
			type?: string;
			tag?: string;
			attributes?: Record<string, unknown>;
			lines?: number[];
			close?: { type?: string; lines?: number[] };
			children?: unknown[];
		};
		if (n.type === 'tag' && n.tag) return n as NonNullable<ReturnType<typeof findFirstTag>>;
		for (const child of n.children ?? []) {
			const found = walk(child);
			if (found) return found;
		}
		return null;
	};
	return walk(ast);
}

// Markdoc's parser turns `$cell.field` into a Variable AST node and `fn(a, b)` into a
// Function AST node. Reconstruct their original source so round-tripping an edit through
// the inspector doesn't stringify them to "[object Object]".
function markdocValueToSource(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const node = value as {
		$$mdtype?: string;
		path?: unknown[];
		name?: string;
		parameters?: Record<string, unknown>;
	};
	if (node.$$mdtype === 'Variable' && Array.isArray(node.path)) {
		return '$' + node.path.map((p) => String(p)).join('.');
	}
	if (node.$$mdtype === 'Function' && typeof node.name === 'string') {
		const params = node.parameters ?? {};
		const args = Object.keys(params)
			.sort((a, b) => Number(a) - Number(b))
			.map((k) => functionArgToSource(params[k]));
		return `${node.name}(${args.join(', ')})`;
	}
	return null;
}

function functionArgToSource(value: unknown): string {
	const ref = markdocValueToSource(value);
	if (ref !== null) return ref;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	return JSON.stringify(value);
}

/** Human-readable attr value for inspector inputs (Markdoc refs, not "[object Object]"). */
export function markdocAttrToDisplay(value: unknown, fallback = ''): string {
	if (value === null || value === undefined) return fallback;
	const mdSource = markdocValueToSource(value);
	if (mdSource !== null) return mdSource;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return JSON.stringify(value);
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

/** Coerce Markdoc Variable/Function AST nodes to plain source strings for JSON storage. */
export function normalizeMarkdocAttrValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	const mdSource = markdocValueToSource(value);
	if (mdSource !== null) return mdSource;
	if (Array.isArray(value)) return value.map(normalizeMarkdocAttrValue);
	return value;
}

export function normalizeMarkdocAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(attrs)) {
		out[k] = normalizeMarkdocAttrValue(v);
	}
	return out;
}

export function markdocAttrsToJson(attrs: Record<string, unknown>): string {
	return JSON.stringify(normalizeMarkdocAttrs(attrs));
}

function formatAttrValue(value: unknown): string {
	if (value === null || value === undefined) return '""';
	const mdSource = markdocValueToSource(value);
	if (mdSource !== null) return mdSource;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return JSON.stringify(value);
	if (typeof value === 'object') return JSON.stringify(value);
	const s = String(value);
	if (/^\$[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(s)) return s;
	if (/^[\w.-]+$/.test(s) && !s.includes(' ')) return `"${s}"`;
	return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeMarkdocTag(
	tagName: string,
	attrs: Record<string, unknown>,
	options: { selfClosing?: boolean; body?: string } = {}
): string {
	const selfClosing = options.selfClosing ?? isSelfClosingTag(tagName);
	if (tagName === 'if') {
		const condition = String(attrs.condition ?? '').trim() || 'true';
		const body = options.body?.trim() ?? '';
		return `{% if ${condition} %}\n${body}\n{% /if %}`;
	}
	const parts = Object.entries(attrs)
		.filter(([k]) => !(tagName === 'if' && k === 'condition'))
		.filter(([, v]) => v !== undefined && v !== null && v !== '')
		// Number inputs in the inspector emit `Number(value)`, which is NaN while the field
		// is empty or mid-edit (e.g. "-", "1e"). Serializing `attr=NaN` is invalid Markdoc
		// ("Expected \"(\"") and breaks the whole block, so drop NaN attrs entirely.
		.filter(([, v]) => !(typeof v === 'number' && Number.isNaN(v)))
		.map(([k, v]) => `${k}=${formatAttrValue(v)}`);
	const attrStr = parts.length ? ` ${parts.join(' ')}` : '';
	if (selfClosing) return `{% ${tagName}${attrStr} /%}`;
	const body = options.body?.trim() ?? '';
	return `{% ${tagName}${attrStr} %}\n${body}\n{% /${tagName} %}`;
}

export function updateBlockWidgetSource(
	block: VisualBlock,
	patch: { tagName?: string; attrs?: Record<string, unknown>; body?: string }
): VisualBlock {
	const parsed = parseBlockWidget(block);
	if (!parsed) return block;
	const tagName = patch.tagName ?? parsed.tagName;
	const attrs = { ...parsed.attrs, ...patch.attrs };
	// `if` conditions live in `parsed.condition` (not a normal attribute). Carry the
	// existing condition forward when the patch doesn't set one, so editing an if block's
	// body doesn't silently reset the condition to `true`.
	if (tagName === 'if' && attrs.condition === undefined && parsed.condition !== undefined) {
		attrs.condition = parsed.condition;
	}
	const body = patch.body !== undefined ? patch.body : parsed.bodySource;
	const source = serializeMarkdocTag(tagName, attrs, {
		selfClosing: parsed.selfClosing,
		body
	});
	return {
		...block,
		source,
		tagName,
		kind: isStructuredMarkdocContainerTag(tagName, { selfClosing: parsed.selfClosing })
			? 'container'
			: 'widget'
	};
}

export function insertVisualBlock(
	blocks: VisualBlock[],
	index: number,
	source: string
): VisualBlock[] {
	const ast = Markdoc.parse(source);
	const first = (ast as { children?: Array<{ type: string; tag?: string; lines?: number[] }> })
		.children?.[0];
	const block: VisualBlock = {
		id: crypto.randomUUID(),
		kind: first ? blockKindForNode(first) : 'prose',
		source: source.trim(),
		tagName: first?.type === 'tag' ? first.tag : undefined
	};
	const next = [...blocks];
	next.splice(index, 0, block);
	return next;
}

export function removeVisualBlock(blocks: VisualBlock[], id: string): VisualBlock[] {
	return blocks.filter((b) => b.id !== id);
}

export function moveVisualBlock(blocks: VisualBlock[], id: string, toIndex: number): VisualBlock[] {
	const from = blocks.findIndex((b) => b.id === id);
	if (from < 0) return blocks;
	const next = [...blocks];
	const [item] = next.splice(from, 1);
	const idx = Math.max(0, Math.min(toIndex, next.length));
	next.splice(idx, 0, item);
	return next;
}

export function visualBlocksRoundTripLossy(markdown: string): {
	lossy: boolean;
	reasons: string[];
} {
	const blocks = parseVisualBlocks(markdown);
	const roundTripped = serializeVisualBlocks(blocks);
	const normalized = (s: string) => s.replace(/\r\n/g, '\n').trim();
	if (normalized(roundTripped) === normalized(markdown)) {
		return { lossy: false, reasons: [] };
	}
	const reasons: string[] = [];
	if (blocks.length === 0 && markdown.trim()) reasons.push('No top-level blocks parsed');
	if (normalized(roundTripped) !== normalized(markdown)) {
		reasons.push('Round-trip markdown differs from source');
	}
	return { lossy: reasons.length > 0, reasons };
}

export function blockSourceOffset(markdown: string, blockId: string): number | null {
	const blocks = parseVisualBlocks(markdown);
	let offset = 0;
	for (const block of blocks) {
		if (block.id === blockId) return offset;
		offset += block.source.length + 2;
	}
	return null;
}

export function diagnosticsForMarkdown(
	markdown: string,
	validate: (md: string) => MarkdocDiagnostic[]
): MarkdocDiagnostic[] {
	return validate(markdown);
}
