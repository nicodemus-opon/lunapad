import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import {
	getModelCompletions,
	getModelPythonContext,
	getModelDialect,
	getModelPythonSchema
} from './completions';
import type { CompletionEntry } from './completions';
import { completePython } from '$lib/services/python-client';
import { getLLMConfig, getGhostTextEnabled } from '$lib/stores/notebook.svelte';

// Ghost-text inline completion ("predict next line", Cursor/Copilot-style) for PRQL, SQL,
// and Python cells. Distinct from registerCompletions' dropdown provider (completions.ts) —
// Monaco's inline-completions API renders the result as native gray ghost text with
// built-in Tab-to-accept / Esc-to-dismiss, so there's no custom rendering here. Debounced
// and cancellable inside the provider itself since Monaco invokes it on every keystroke and
// nothing upstream debounces completion requests the way it does PRQL compilation.

const DEBOUNCE_MS = 500;
const MAX_PREFIX_CHARS = 2000;
const PREFIX_LINES = 50;

interface PendingFetch {
	timer: ReturnType<typeof setTimeout>;
	controller: AbortController;
}

// Per-model debounce — avoids cross-cell timer interference.
const pendingByModel = new Map<string, PendingFetch>();
// Session-scoped cache — only successful non-empty completions.
const completionCache = new Map<string, string>();
// Suppress ghost text while inline AI is streaming into a cell editor.
const inlineEditActiveModels = new Set<string>();

export function setGhostInlineEditActive(modelUri: string, active: boolean): void {
	if (active) inlineEditActiveModels.add(modelUri);
	else inlineEditActiveModels.delete(modelUri);
}

function cacheKey(modelUri: string, prefix: string): string {
	return `${modelUri}::${prefix}`;
}

function hasLLMConfig(): boolean {
	const llmConfig = getLLMConfig();
	return Boolean(llmConfig?.baseUrl?.trim() && llmConfig?.model?.trim());
}

function clearPending(modelUri: string): void {
	const pending = pendingByModel.get(modelUri);
	if (!pending) return;
	clearTimeout(pending.timer);
	pending.controller.abort();
	pendingByModel.delete(modelUri);
}

function buildPrefix(model: Monaco.editor.ITextModel, position: Monaco.Position): string {
	const startLine = Math.max(1, position.lineNumber - PREFIX_LINES);
	const range = {
		startLineNumber: startLine,
		startColumn: 1,
		endLineNumber: position.lineNumber,
		endColumn: position.column
	};
	const text = model.getValueInRange(range);
	return text.length > MAX_PREFIX_CHARS ? text.slice(-MAX_PREFIX_CHARS) : text;
}

// Up to 8 lines after the cursor — tells the model what to bridge toward.
function buildSuffix(model: Monaco.editor.ITextModel, position: Monaco.Position): string {
	const totalLines = model.getLineCount();
	const endLine = Math.min(totalLines, position.lineNumber + 8);
	if (endLine <= position.lineNumber) return '';
	const range = {
		startLineNumber: position.lineNumber,
		startColumn: position.column,
		endLineNumber: endLine,
		endColumn: model.getLineMaxColumn(endLine)
	};
	return model.getValueInRange(range).slice(0, 400);
}

// Groups table.column entries by table with their type details so the model sees
// "orders: id(int), status(varchar)" rather than a flat comma-dump it has to parse.
function buildSchemaString(entries: CompletionEntry[]): string {
	const tables = new Map<string, string[]>();
	const bare: string[] = [];
	for (const e of entries) {
		const dot = e.text.indexOf('.');
		if (dot > 0 && dot < e.text.length - 1) {
			const table = e.text.slice(0, dot);
			const col = e.text.slice(dot + 1);
			if (!tables.has(table)) tables.set(table, []);
			tables.get(table)!.push(e.detail ? `${col}(${e.detail})` : col);
		} else {
			bare.push(e.detail ? `${e.text}(${e.detail})` : e.text);
		}
	}
	const lines: string[] = [];
	for (const [table, cols] of tables) lines.push(`${table}: ${cols.join(', ')}`);
	if (bare.length) lines.push(bare.join(', '));
	return lines.join('\n');
}

async function buildContextHints(
	languageId: 'prql' | 'sql' | 'python',
	model: Monaco.editor.ITextModel,
	position: Monaco.Position,
	signal: AbortSignal
): Promise<{ schema: string; dialect?: string; pythonKind?: 'udf' | 'data' }> {
	if (languageId === 'python') {
		const pyContext = getModelPythonContext(model);
		if (!pyContext || pyContext.kind === 'udf') return { schema: '', pythonKind: 'udf' };

		const upstreamSchemas = getModelPythonSchema(model);
		const schemaNames = new Set(upstreamSchemas.map((s) => s.name));
		const lines: string[] = upstreamSchemas.map((s) =>
			s.columns.length > 0 ? `${s.name}: ${s.columns.join(', ')}` : s.name
		);

		try {
			const items = await completePython(
				pyContext.notebookId,
				model.getValue(),
				position.lineNumber,
				position.column - 1,
				signal
			);
			const extra = items
				.filter((i) => !schemaNames.has(i.name) && !i.name.startsWith('_'))
				.slice(0, 20)
				.map((i) => (i.detail && i.detail !== i.name ? `${i.name}(${i.detail})` : i.name));
			if (extra.length > 0) lines.push(`also available: ${extra.join(', ')}`);
		} catch {
			// jedi unavailable — upstream schema alone is already valuable
		}

		return { schema: lines.join('\n'), pythonKind: 'data' };
	}
	const entries = getModelCompletions(model);
	const dialect = getModelDialect(model);
	return {
		schema: buildSchemaString(entries.slice(0, 60)),
		dialect: dialect ?? undefined
	};
}

async function fetchCompletion(
	language: 'prql' | 'sql' | 'python',
	prefix: string,
	suffix: string,
	schema: string,
	dialect: string | undefined,
	pythonKind: 'udf' | 'data' | undefined,
	signal: AbortSignal
): Promise<string> {
	const llmConfig = getLLMConfig();
	if (!llmConfig?.baseUrl?.trim() || !llmConfig?.model?.trim()) return '';
	const effectiveConfig = llmConfig.completionModel?.trim()
		? { ...llmConfig, model: llmConfig.completionModel.trim() }
		: llmConfig;
	try {
		const res = await fetch('/api/ai/complete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				language,
				prefix,
				suffix,
				schema,
				dialect,
				pythonKind,
				llmConfig: effectiveConfig
			}),
			signal
		});
		if (!res.ok) return '';
		const data = (await res.json()) as { completion?: string };
		return data.completion ?? '';
	} catch {
		return '';
	}
}

function makeInlineItem(
	monaco: typeof Monaco,
	position: Monaco.Position,
	insertText: string
): Monaco.languages.InlineCompletion {
	return {
		insertText,
		range: new monaco.Range(
			position.lineNumber,
			position.column,
			position.lineNumber,
			position.column
		)
	};
}

function ghostApiLanguage(languageId: string): 'prql' | 'sql' | 'python' {
	if (languageId === 'trinosql' || languageId === 'genericsql' || languageId === 'sql')
		return 'sql';
	if (languageId === 'python') return 'python';
	return 'prql';
}

export function registerGhostCompletions(monaco: typeof Monaco): void {
	for (const languageId of ['prql', 'sql', 'trinosql', 'genericsql', 'python'] as const) {
		const apiLanguage = ghostApiLanguage(languageId);
		monaco.languages.registerInlineCompletionsProvider(languageId, {
			async provideInlineCompletions(model, position, _context, token) {
				if (!getGhostTextEnabled()) return { items: [] };

				const modelUri = model.uri.toString();
				if (inlineEditActiveModels.has(modelUri)) return { items: [] };

				const prefix = buildPrefix(model, position);
				if (!prefix.trim()) return { items: [] };
				if (!hasLLMConfig()) return { items: [] };

				const suffix = buildSuffix(model, position);
				const key = cacheKey(modelUri, prefix + '||' + suffix);
				const cached = completionCache.get(key);
				if (cached !== undefined) {
					return { items: [makeInlineItem(monaco, position, cached)] };
				}

				const result = await new Promise<string>((resolve) => {
					clearPending(modelUri);
					const controller = new AbortController();
					token.onCancellationRequested(() => {
						controller.abort();
						clearPending(modelUri);
						resolve('');
					});
					const timer = setTimeout(() => {
						pendingByModel.delete(modelUri);
						buildContextHints(apiLanguage, model, position, controller.signal)
							.then(({ schema, dialect, pythonKind }) =>
								fetchCompletion(
									apiLanguage,
									prefix,
									suffix,
									schema,
									dialect,
									pythonKind,
									controller.signal
								)
							)
							.then(resolve, () => resolve(''));
					}, DEBOUNCE_MS);
					pendingByModel.set(modelUri, { timer, controller });
				});

				if (token.isCancellationRequested || !result) {
					completionCache.delete(key);
					if (!result && !token.isCancellationRequested) {
						console.debug(
							`[ghost] empty completion (${languageId}, prefix ${prefix.length} chars)`
						);
					}
					return { items: [] };
				}

				completionCache.set(key, result);
				if (completionCache.size > 200) {
					completionCache.delete(completionCache.keys().next().value as string);
				}
				return { items: [makeInlineItem(monaco, position, result)] };
			},
			disposeInlineCompletions() {
				// Nothing to dispose — items carry no external resources.
			}
		});
	}
}
