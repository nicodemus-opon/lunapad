import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { LUNAPAD_MARKDOWN_LANG } from '$lib/monaco/lunapad-markdown';
import {
	buildContextualMarkdocSnippet,
	getUsableMarkdocRefEntry
} from '$lib/services/markdoc-contextual-snippets';
import { SLASH_COMMANDS } from '$lib/services/markdown-format';
import {
	MARKDOC_FUNCTIONS,
	MARKDOC_REF_PSEUDO_FIELDS,
	MARKDOC_TAG_CATALOG,
	type MarkdownRefEntry,
	isSelfClosingTag
} from '$lib/services/markdoc-catalog';

export const MARKDOWN_LANG_IDS = ['markdown', LUNAPAD_MARKDOWN_LANG] as const;

export interface MarkdownRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export type MarkdownCompletionContext =
	| { kind: 'slash'; partial: string; range: MarkdownRange }
	| { kind: 'tag-open'; partial: string; range: MarkdownRange }
	| { kind: 'tag-close'; partial: string; openTags: string[]; range: MarkdownRange }
	| {
			kind: 'attr-name';
			tagName: string;
			partial: string;
			usedAttrs: Set<string>;
			range: MarkdownRange;
	  }
	| { kind: 'attr-enum'; tagName: string; attrName: string; partial: string; range: MarkdownRange }
	| {
			kind: 'attr-column';
			tagName: string;
			attrName: string;
			cellName: string;
			partial: string;
			range: MarkdownRange;
	  }
	| { kind: 'ref-root'; partial: string; range: MarkdownRange }
	| { kind: 'ref-member'; cellName: string; partial: string; range: MarkdownRange }
	| { kind: 'function'; partial: string; range: MarkdownRange }
	| { kind: 'none' };

const COLUMN_ATTRS = new Set([
	'x',
	'y',
	'yColumns',
	'yColumnsSecondary',
	'colorColumn',
	'sizeColumn',
	'cols',
	'optionsColumn',
	'by'
]);

const markdownModelRefs = new Map<string, MarkdownRefEntry[]>();
let completionProviderRegistered = false;

export function setMarkdownModelRefs(modelUri: string, refs: MarkdownRefEntry[]): void {
	markdownModelRefs.set(modelUri, refs);
}

export function clearMarkdownModelRefs(modelUri: string): void {
	markdownModelRefs.delete(modelUri);
}

export function getMarkdownModelRefs(modelUri: string): MarkdownRefEntry[] {
	return markdownModelRefs.get(modelUri) ?? [];
}

/** Scan document for unclosed block tags (for close-tag completion). */
export function getOpenMarkdocTags(markdown: string): string[] {
	const stack: string[] = [];
	const re = /\{%\s*(\/?)(\w+)([^%]*?)%\}/g;
	for (const m of markdown.matchAll(re)) {
		const closing = m[1] === '/';
		const name = m[2];
		const tail = m[3];
		const selfClosing = tail.trimEnd().endsWith('/') || isSelfClosingTag(name);
		if (closing) {
			const idx = stack.lastIndexOf(name);
			if (idx >= 0) stack.splice(idx, 1);
		} else if (!selfClosing) {
			stack.push(name);
		}
	}
	return stack;
}

/** Nearest unclosed {% tag %} before cursor (supports multi-line open tags). */
export function resolveActiveTag(
	textUpToCursor: string
): { tagName: string; fragment: string } | null {
	const openIdx = textUpToCursor.lastIndexOf('{%');
	if (openIdx < 0) return null;
	const fragment = textUpToCursor.slice(openIdx);
	if (fragment.includes('%}')) return null;
	const tagMatch = fragment.match(/^\{%\s*\/?(\w+)([\s\S]*)$/);
	if (!tagMatch) return null;
	return { tagName: tagMatch[1], fragment: tagMatch[2] };
}

function parseUsedAttrs(fragment: string): Set<string> {
	const used = new Set<string>();
	for (const m of fragment.matchAll(/\b([a-zA-Z_]\w*)\s*=/g)) {
		used.add(m[1]);
	}
	return used;
}

function inferCellFromTagFragment(fragment: string): string | null {
	const m = fragment.match(/\b(?:data|ref|value)\s*=\s*\$(\w+)/);
	return m?.[1] ?? null;
}

function isExpressionContext(fragment: string): boolean {
	let depth = 0;
	for (const ch of fragment) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
	}
	return depth > 0;
}

function lineUpToCursorFromText(textUpToCursor: string): string {
	const nl = textUpToCursor.lastIndexOf('\n');
	return nl < 0 ? textUpToCursor : textUpToCursor.slice(nl + 1);
}

export function detectMarkdownCompletionContext(
	textUpToCursor: string,
	fullText: string
): MarkdownCompletionContext {
	const lineUpToCursor = lineUpToCursorFromText(textUpToCursor);
	const column = lineUpToCursor.length + 1;

	const makeRange = (startColumn: number): MarkdownRange => ({
		startLineNumber: 0,
		startColumn,
		endLineNumber: 0,
		endColumn: column
	});

	// Close tag: {% /partial
	const closeMatch = lineUpToCursor.match(/\{%\s*\/(\w*)$/);
	if (closeMatch) {
		const partial = closeMatch[1];
		return {
			kind: 'tag-close',
			partial,
			openTags: getOpenMarkdocTags(fullText),
			range: makeRange(column - partial.length)
		};
	}

	const active = resolveActiveTag(textUpToCursor);

	// Enum / column attribute value: attr="partial
	const enumMatch = textUpToCursor.match(/\b(\w+)\s*=\s*"([^"]*)$/);
	if (enumMatch && active) {
		const partial = enumMatch[2];
		const attrName = enumMatch[1];
		const attrStart = column - partial.length;

		if (COLUMN_ATTRS.has(attrName)) {
			const cellName = inferCellFromTagFragment(active.fragment);
			if (cellName) {
				return {
					kind: 'attr-column',
					tagName: active.tagName,
					attrName,
					cellName,
					partial,
					range: makeRange(attrStart)
				};
			}
		}

		const tag = MARKDOC_TAG_CATALOG[active.tagName];
		if (tag?.attributes?.[attrName]?.enum) {
			return {
				kind: 'attr-enum',
				tagName: active.tagName,
				attrName,
				partial,
				range: makeRange(attrStart)
			};
		}
	}

	// Function names inside tag expressions ({% if gt(… %})
	if (active && isExpressionContext(active.fragment)) {
		const fnPartialMatch = active.fragment.match(/(\w*)$/);
		if (fnPartialMatch) {
			const partial = fnPartialMatch[1];
			const fnNames = Object.keys(MARKDOC_FUNCTIONS);
			const matchesFn =
				partial.length === 0 ||
				fnNames.some((f) => f.toLowerCase().startsWith(partial.toLowerCase()));
			if (matchesFn) {
				return {
					kind: 'function',
					partial,
					range: makeRange(column - partial.length)
				};
			}
		}
	}

	// Attribute name inside open tag (after tag name + whitespace)
	if (active && /\s/.test(active.fragment)) {
		const attrPartialMatch = active.fragment.match(/(?:^|\s)(\w*)$/);
		if (attrPartialMatch && !active.fragment.trimEnd().endsWith('=')) {
			const partial = attrPartialMatch[1];
			if (partial !== active.tagName) {
				return {
					kind: 'attr-name',
					tagName: active.tagName,
					partial,
					usedAttrs: parseUsedAttrs(active.fragment),
					range: makeRange(column - partial.length)
				};
			}
		}
	}

	// Ref member: $cell.partial
	const refMemberMatch = lineUpToCursor.match(/\$(\w+)\.(\w*)$/);
	if (refMemberMatch) {
		const cellName = refMemberMatch[1];
		const partial = refMemberMatch[2];
		const dollarPos = lineUpToCursor.lastIndexOf('$');
		return {
			kind: 'ref-member',
			cellName,
			partial,
			range: makeRange(dollarPos + 1 + cellName.length + 1)
		};
	}

	// Ref root: $partial
	const refRootMatch = lineUpToCursor.match(/\$(\w*)$/);
	if (refRootMatch) {
		const partial = refRootMatch[1];
		const dollarPos = lineUpToCursor.lastIndexOf('$');
		return {
			kind: 'ref-root',
			partial,
			range: makeRange(dollarPos + 1)
		};
	}

	// Slash command
	const slashMatch = lineUpToCursor.match(/^\s*\/(\w*)$/);
	if (slashMatch) {
		const partial = slashMatch[1];
		const slashCol = lineUpToCursor.indexOf('/') + 1;
		return {
			kind: 'slash',
			partial,
			range: makeRange(slashCol)
		};
	}

	// Open tag or function: {% partial
	const tagMatch = lineUpToCursor.match(/\{%\s*(\w*)$/);
	if (tagMatch) {
		const partial = tagMatch[1];
		const tagNames = Object.keys(MARKDOC_TAG_CATALOG);
		const fnNames = Object.keys(MARKDOC_FUNCTIONS);
		const matchesTag = partial.length === 0 || tagNames.some((t) => t.startsWith(partial));
		const matchesFn = partial.length > 0 && fnNames.some((f) => f.startsWith(partial));
		if (matchesFn && !matchesTag) {
			return {
				kind: 'function',
				partial,
				range: makeRange(column - partial.length)
			};
		}
		return {
			kind: 'tag-open',
			partial,
			range: makeRange(column - partial.length)
		};
	}

	return { kind: 'none' };
}

function filterByPartial(items: string[], partial: string): string[] {
	const q = partial.toLowerCase();
	if (!q) return items;
	return items.filter((item) => item.toLowerCase().startsWith(q));
}

function buildRefMemberSuggestions(
	m: typeof Monaco,
	entry: MarkdownRefEntry | undefined,
	partial: string,
	range: MarkdownRange,
	columnsOnly = false
): Monaco.languages.CompletionItem[] {
	const kinds = m.languages.CompletionItemKind;
	const suggestions: Monaco.languages.CompletionItem[] = [];

	if (!columnsOnly) {
		for (const field of MARKDOC_REF_PSEUDO_FIELDS) {
			if (partial && !field.name.startsWith(partial)) continue;
			suggestions.push({
				label: field.name,
				kind: kinds.Property,
				detail: field.detail,
				insertText: field.name,
				range,
				sortText: `0_${field.name}`
			});
		}
	}

	if (entry) {
		for (const col of entry.columns) {
			if (partial && !col.name.startsWith(partial)) continue;
			suggestions.push({
				label: col.name,
				kind: kinds.Field,
				detail: col.type,
				insertText: col.name,
				range,
				sortText: `1_${col.name}`
			});
		}
	}

	return suggestions;
}

function contextSuggestions(
	m: typeof Monaco,
	ctx: MarkdownCompletionContext,
	refs: MarkdownRefEntry[],
	lineNumber: number
): Monaco.languages.CompletionItem[] {
	const range: MarkdownRange = {
		...('range' in ctx ? ctx.range : { startColumn: 1, endColumn: 1 }),
		startLineNumber: lineNumber,
		endLineNumber: lineNumber
	};
	const kinds = m.languages.CompletionItemKind;

	switch (ctx.kind) {
		case 'slash': {
			const commands = getUsableMarkdocRefEntry(refs)
				? SLASH_COMMANDS
				: SLASH_COMMANDS.filter((cmd) => cmd.group !== 'report');
			return filterByPartial(
				commands.map((c) => c.id),
				ctx.partial
			).map((id) => {
				const cmd = commands.find((c) => c.id === id)!;
				return {
					label: '/' + cmd.id,
					detail: cmd.description,
					documentation: cmd.label,
					kind: kinds.Snippet,
					insertText: buildContextualMarkdocSnippet(cmd.id, refs) || cmd.snippet,
					insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					range,
					sortText: `0_${cmd.id}`
				};
			});
		}

		case 'tag-open':
			return filterByPartial(Object.keys(MARKDOC_TAG_CATALOG), ctx.partial).map((name) => {
				const tag = MARKDOC_TAG_CATALOG[name];
				return {
					label: name,
					detail: tag.detail,
					kind: kinds.Keyword,
					insertText: tag.snippet,
					insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					range,
					sortText: `1_${name}`
				};
			});

		case 'tag-close': {
			const tags = filterByPartial([...new Set(ctx.openTags)].reverse(), ctx.partial);
			return tags.map((name) => ({
				label: '/' + name,
				detail: `Close {% ${name} %}`,
				kind: kinds.Keyword,
				insertText: name + ' %}',
				range,
				sortText: `1_${name}`
			}));
		}

		case 'attr-name': {
			const tag = MARKDOC_TAG_CATALOG[ctx.tagName];
			if (!tag?.attributes) return [];
			return filterByPartial(Object.keys(tag.attributes), ctx.partial)
				.filter((name) => !ctx.usedAttrs.has(name))
				.map((name) => {
					const attr = tag.attributes![name];
					return {
						label: name,
						detail: attr.detail ?? (attr.required ? 'required' : undefined),
						kind: kinds.Property,
						insertText: attr.enum ? `${name}="\${1|${attr.enum.join(',')}|}"` : `${name}=\${1}`,
						insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
						range,
						sortText: `2_${name}`
					};
				});
		}

		case 'attr-enum': {
			const tag = MARKDOC_TAG_CATALOG[ctx.tagName];
			const attr = tag?.attributes?.[ctx.attrName];
			if (!attr?.enum) return [];
			return filterByPartial([...attr.enum], ctx.partial).map((value) => ({
				label: value,
				kind: kinds.EnumMember,
				insertText: value,
				range,
				sortText: `2_${value}`
			}));
		}

		case 'attr-column': {
			const entry = refs.find((r) => r.cellName === ctx.cellName);
			return buildRefMemberSuggestions(m, entry, ctx.partial, range, true);
		}

		case 'ref-root':
			return filterByPartial(
				refs.map((r) => r.cellName),
				ctx.partial
			).map((cellName) => ({
				label: '$' + cellName,
				kind: kinds.Variable,
				insertText: cellName,
				range,
				sortText: `3_${cellName}`
			}));

		case 'ref-member': {
			const entry = refs.find((r) => r.cellName === ctx.cellName);
			return buildRefMemberSuggestions(m, entry, ctx.partial, range);
		}

		case 'function':
			return filterByPartial(Object.keys(MARKDOC_FUNCTIONS), ctx.partial).map((name) => {
				const fn = MARKDOC_FUNCTIONS[name];
				return {
					label: name,
					detail: fn.signature,
					documentation: fn.detail,
					kind: kinds.Function,
					insertText: fn.snippet,
					insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					range,
					sortText: `4_${name}`
				};
			});

		default:
			return [];
	}
}

export function registerMarkdownCompletions(m: typeof Monaco): void {
	if (completionProviderRegistered) return;
	completionProviderRegistered = true;

	const provider: Monaco.languages.CompletionItemProvider = {
		triggerCharacters: ['/', '$', '{', '"', '=', '.', '%'],
		provideCompletionItems(model, position) {
			const textUpToCursor = model.getValueInRange({
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: position.lineNumber,
				endColumn: position.column
			});
			const fullText = model.getValue();
			const ctx = detectMarkdownCompletionContext(textUpToCursor, fullText);
			if (ctx.kind === 'none') return { suggestions: [] };

			const refs = getMarkdownModelRefs(model.uri.toString());
			return {
				suggestions: contextSuggestions(m, ctx, refs, position.lineNumber)
			};
		}
	};

	for (const langId of MARKDOWN_LANG_IDS) {
		m.languages.registerCompletionItemProvider(langId, provider);
	}
}
