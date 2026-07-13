/** Server-side guardrails for native chat tool calls before they reach the client. */

import { getCriticalMarkdownFailures } from '$lib/agent/evals/dashboard-grade.js';

export interface ChatToolPolicyContext {
	schemaTableNames: Set<string>;
	cellOutputNames: Set<string>;
	/** outputNames (lowercased) whose own chart already has an xColumn set — what
	 *  `ref=$cellName` actually inherits. Optional so tests/eval callers that don't track
	 *  live chart state can omit it (falls back to permissive validation). */
	chartedOutputNames?: Set<string>;
	/** Real result column names per outputName (from AIChatCell.resultColumns — the server never
	 *  sees row values). Lets markdown validation resolve Markdoc variables against the actual
	 *  schema instead of falling back to a generic mock row — see getCriticalMarkdownFailures. */
	columnsByOutputName?: Map<string, string[]>;
	latestUserMessage: string;
}

export function isNativeToolCallWellFormed(tool: string, args: Record<string, unknown>): boolean {
	const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
	switch (tool) {
		case 'create_notebook':
			// Only require a real blueprint object — NOT that `blocks` is already a populated
			// array. Same reasoning as apply_notebook_patch below: compileNotebookBlueprint (run
			// by the real handler in ai-chat-client.ts) already gives a specific, actionable
			// diagnostic for a missing/malformed `blocks` (or a model that used `executableCells`
			// without `blocks`, or nested them under `document`/`operations` instead). Rejecting
			// here — before the tool call is ever emitted to the client to execute — converts a
			// repairable, specific compiler diagnostic into a silent drop: blockedToolFallbackText
			// below has no case for `create_notebook`, so the model gets zero feedback and the
			// whole turn just surfaces as the generic, unhelpful "Model returned an empty
			// response" error. Found live against a real model whose blueprint used
			// `executableCells` but omitted `blocks` entirely.
			return (
				!!args.blueprint && typeof args.blueprint === 'object' && !Array.isArray(args.blueprint)
			);
		case 'inspect_notebook':
		case 'validate_notebook':
			return true;
		case 'apply_notebook_patch':
			// blueprint/document/operations is the normal content-editing path, but the
			// handler also supports a title-only rename with none of those set (see
			// ai-chat-client.ts's `if (!document) { if (notebookTitle?.trim()) { ... } }`
			// branch) — rejecting that here as "not well-formed" silently drops a valid
			// tool call and falsely surfaces "Model returned an empty response".
			//
			// A model that sends `executableCells` without a wrapping blueprint/document
			// (missing the block placement) is genuinely incomplete, but rejecting it HERE
			// converts that into the same unhelpful blanket "empty response" — the handler
			// itself returns a specific, actionable "provide blueprint, document, operations,
			// or title" message instead, which the self-correction retry loop already knows
			// how to catch (see dashboard-loop-signals.ts). Let executableCells-only calls
			// reach the handler so the model gets that real diagnostic to fix itself with.
			return Boolean(
				args.blueprint ||
				args.document ||
				args.operations ||
				str(args.title) ||
				(Array.isArray(args.executableCells) && args.executableCells.length > 0)
			);
		case 'run_query_nodes':
			// The handler explicitly supports omitting both nodeIds and cellIds — it falls
			// back to queryBlockCellIdsFromDocument(document, undefined), which (undefined
			// nodeIds → no filter) returns every queryBlock cellId in the notebook, i.e.
			// "run everything". Rejecting the no-args call here as "not well-formed" drops
			// that legitimate fallback and falsely surfaces "Model returned an empty
			// response" for a call the handler was designed to accept.
			return true;
		case 'profile_column':
			return str(args.table) && str(args.column);
		case 'sample_data':
			return str(args.table);
		case 'query_data':
			return str(args.sql);
		case 'get_lineage':
		case 'get_cell_result':
			return str(args.outputName) || str(args.cellId);
		case 'search_workspace':
			return str(args.query);
		case 'create_cell': {
			if (!str(args.outputName)) return false;
			if (
				args.cellType === 'markdown' ||
				args.markdown !== undefined ||
				args.dashboard !== undefined
			) {
				return (
					str(args.markdown ?? args.code) ||
					(!!args.dashboard && typeof args.dashboard === 'object')
				);
			}
			return str(args.code);
		}
		case 'update_cell':
			return str(args.cellId) || str(args.outputName);
		case 'delete_cell':
			return str(args.cellId) || str(args.outputName);
		case 'run_cells':
			// The handler explicitly supports omitting cellIds — it falls back to every
			// ghost cell created this generation (`[..._outputNameToId.values()]`), i.e.
			// "run what I just created/patched". Rejecting the no-args call here drops
			// that legitimate fallback and falsely surfaces "Model returned an empty
			// response" for a call the handler was designed to accept.
			return true;
		case 'pick_chart':
		case 'set_chart':
			return str(args.cellId);
		default:
			return true;
	}
}

function tableKnown(name: string, ctx: ChatToolPolicyContext): boolean {
	const t = name.trim().toLowerCase();
	if (!t) return false;
	const base = t.split('.').pop() ?? t;
	return (
		ctx.schemaTableNames.has(t) || ctx.schemaTableNames.has(base) || ctx.cellOutputNames.has(base)
	);
}

/** Tables referenced in SQL/PRQL cell code (FROM/JOIN / PRQL from / "table X"). */
export function tablesReferencedInCode(code: string): string[] {
	const names = new Set<string>();
	for (const m of code.matchAll(/\b(?:from|join|table)\s+[`"']?([a-z][a-z0-9_]*)/gi)) {
		names.add(m[1]);
	}
	return [...names];
}

function codeReferencesUnknownTable(code: string, ctx: ChatToolPolicyContext): string | null {
	for (const table of tablesReferencedInCode(code)) {
		if (!tableKnown(table, ctx)) return table;
	}
	return null;
}

export function isChatToolCallAllowed(
	tool: string,
	args: Record<string, unknown>,
	ctx: ChatToolPolicyContext
): boolean {
	if (!isNativeToolCallWellFormed(tool, args)) return false;

	if (tool === 'delete_cell') {
		const cellId = String(args.cellId ?? args.outputName ?? '')
			.trim()
			.toLowerCase();
		if (/^(all|\*|every|entire|notebook|everything)$/i.test(cellId)) return false;
		if (
			/delete\s+all|wipe\s+(everything|all)|remove\s+all\s+cells|drop\s+(the\s+)?entire/i.test(
				ctx.latestUserMessage
			)
		) {
			return false;
		}
	}

	if (tool === 'sample_data') {
		const table = String(args.table ?? '');
		if (table && !tableKnown(table, ctx)) return false;
	}

	if (tool === 'query_data') {
		const sql = String(args.sql ?? '');
		for (const m of sql.matchAll(/\bfrom\s+[`"']?([a-z0-9_]+)[`"']?/gi)) {
			if (!tableKnown(m[1], ctx)) return false;
		}
	}

	if (tool === 'create_cell' || tool === 'update_cell') {
		const code = String(args.code ?? '');
		if (code && codeReferencesUnknownTable(code, ctx)) return false;
		const markdown = String(args.markdown ?? (args.cellType === 'markdown' ? args.code : '') ?? '');
		if (
			markdown.trim() &&
			getCriticalMarkdownFailures(
				markdown,
				ctx.cellOutputNames,
				ctx.chartedOutputNames,
				ctx.columnsByOutputName
			).length > 0
		) {
			return false;
		}
	}

	return true;
}

export function blockedToolFallbackText(
	tool: string,
	args: Record<string, unknown>,
	ctx: ChatToolPolicyContext,
	schemaTables: Array<{ name: string; columns: string[] }>
): string | null {
	if (tool === 'delete_cell') {
		return 'I will not delete cells unless you name one specific cell outputName to remove.';
	}
	if (tool === 'create_notebook' && !(args.blueprint && typeof args.blueprint === 'object')) {
		return 'create_notebook requires a `blueprint` object (with a `title` and `blocks` array). Provide one and call create_notebook again.';
	}
	if (tool === 'sample_data' || tool === 'query_data') {
		const table =
			tool === 'sample_data'
				? String(args.table ?? '')
				: (String(args.sql ?? '').match(/\bfrom\s+[`"']?([a-z0-9_]+)/i)?.[1] ?? '');
		if (table && !tableKnown(table, ctx)) {
			const available = schemaTables.map((t) => `\`${t.name}\``).join(', ');
			const cells = [...ctx.cellOutputNames].map((n) => `\`${n}\``).join(', ');
			return `Table \`${table}\` does not exist — it is not one of the workspace tables or cell outputs listed below. Do not guess another name; pick one from this exact list. Available tables: ${available || '(none)'}. Available cell outputs: ${cells || '(none)'}.`;
		}
	}
	if (tool === 'create_cell' || tool === 'update_cell') {
		const code = String(args.code ?? '');
		const unknown = codeReferencesUnknownTable(code, ctx);
		if (unknown) {
			const available = schemaTables.map((t) => `\`${t.name}\``).join(', ');
			const cells = [...ctx.cellOutputNames].map((n) => `\`${n}\``).join(', ');
			return `Cannot write code referencing \`${unknown}\` — it does not exist in the workspace schema or as a cell output. Do not guess another name; use only a name from this exact list. Available tables: ${available || '(none)'}. Available cell outputs: ${cells || '(none)'}.`;
		}
		const markdown = String(args.markdown ?? (args.cellType === 'markdown' ? args.code : '') ?? '');
		const mdFailures = getCriticalMarkdownFailures(
			markdown,
			ctx.cellOutputNames,
			ctx.chartedOutputNames,
			ctx.columnsByOutputName
		);
		if (mdFailures.length > 0) {
			// Undefined-variable rejections are only actionable if the model learns the REAL
			// column list — without it, it can only guess again and loop. Attach the columns of
			// every cell whose refs failed (case-insensitive: refs use authored casing, the
			// columns map is keyed by outputName as sent by the client).
			const columnsLower = new Map(
				[...(ctx.columnsByOutputName ?? [])].map(([name, cols]) => [name.toLowerCase(), cols])
			);
			const hints: string[] = [];
			const hinted = new Set<string>();
			for (const f of mdFailures) {
				const root = f.match(/^Undefined variable: '([A-Za-z_]\w*)/)?.[1]?.toLowerCase();
				if (!root || hinted.has(root)) continue;
				hinted.add(root);
				const cols = columnsLower.get(root);
				if (cols?.length)
					hints.push(`Cell '${root}' has exactly these columns: ${cols.join(', ')}.`);
			}
			return `Markdown validation failed: ${mdFailures.slice(0, 3).join('; ')}. ${hints.join(' ')} Fix Markdoc syntax and $cell refs before creating the cell.`.replace(
				/\s{2,}/g,
				' '
			);
		}
	}
	return null;
}
