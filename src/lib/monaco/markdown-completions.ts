import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import { SLASH_COMMANDS } from '$lib/services/markdown-format';
import {
	MARKDOC_FUNCTIONS,
	MARKDOC_REF_PSEUDO_FIELDS,
	MARKDOC_TAG_CATALOG,
	type MarkdownRefEntry,
	isSelfClosingTag
} from '$lib/services/markdoc-catalog';

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
	| { kind: 'ref-root'; partial: string; range: MarkdownRange }
	| { kind: 'ref-member'; cellName: string; partial: string; range: MarkdownRange }
	| { kind: 'function'; partial: string; range: MarkdownRange }
	| { kind: 'none' };

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

function resolveActiveTag(lineUpToCursor: string): { tagName: string; fragment: string } | null {
	const openIdx = lineUpToCursor.lastIndexOf('{%');
	if (openIdx < 0) return null;
	const fragment = lineUpToCursor.slice(openIdx);
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

export function detectMarkdownCompletionContext(
	lineUpToCursor: string,
	fullText: string,
	column: number
): MarkdownCompletionContext {
	const makeRange = (startColumn: number): MarkdownRange => ({
		startLineNumber: 0, // caller fills line number
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

	// Enum attribute value: attr="partial
	const enumMatch = lineUpToCursor.match(/\b(\w+)\s*=\s*"([^"]*)$/);
	if (enumMatch) {
		const active = resolveActiveTag(lineUpToCursor);
		if (active) {
			const partial = enumMatch[2];
			const attrStart = column - partial.length;
			return {
				kind: 'attr-enum',
				tagName: active.tagName,
				attrName: enumMatch[1],
				partial,
				range: makeRange(attrStart)
			};
		}
	}

	// Attribute name inside open tag (after tag name + whitespace)
	const active = resolveActiveTag(lineUpToCursor);
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
	cellName: string,
	partial: string,
	range: MarkdownRange
): Monaco.languages.CompletionItem[] {
	const kinds = m.languages.CompletionItemKind;
	const suggestions: Monaco.languages.CompletionItem[] = [];

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
		case 'slash':
			return filterByPartial(
				SLASH_COMMANDS.map((c) => c.id),
				ctx.partial
			).map((id) => {
				const cmd = SLASH_COMMANDS.find((c) => c.id === id)!;
				return {
					label: '/' + cmd.id,
					detail: cmd.description,
					documentation: cmd.label,
					kind: kinds.Snippet,
					insertText: cmd.snippet,
					insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
					range,
					sortText: `0_${cmd.id}`
				};
			});

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
			return buildRefMemberSuggestions(m, entry, ctx.cellName, ctx.partial, range);
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

	m.languages.registerCompletionItemProvider('markdown', {
		triggerCharacters: ['/', '$', '{', '"', '=', '.'],
		provideCompletionItems(model, position) {
			const lineUpToCursor = model.getValueInRange({
				startLineNumber: position.lineNumber,
				startColumn: 1,
				endLineNumber: position.lineNumber,
				endColumn: position.column
			});
			const fullText = model.getValue();
			const ctx = detectMarkdownCompletionContext(lineUpToCursor, fullText, position.column);
			if (ctx.kind === 'none') return { suggestions: [] };

			const refs = getMarkdownModelRefs(model.uri.toString());
			return {
				suggestions: contextSuggestions(m, ctx, refs, position.lineNumber)
			};
		}
	});
}
