/** Server-side guardrails for native chat tool calls before they reach the client. */

import { getCriticalMarkdownFailures } from '$lib/agent/evals/dashboard-grade.js';

export interface ChatToolPolicyContext {
	schemaTableNames: Set<string>;
	cellOutputNames: Set<string>;
	/** outputNames (lowercased) whose own chart already has an xColumn set — what
	 *  `ref=$cellName` actually inherits. Optional so tests/eval callers that don't track
	 *  live chart state can omit it (falls back to permissive validation). */
	chartedOutputNames?: Set<string>;
	latestUserMessage: string;
}

export function isNativeToolCallWellFormed(tool: string, args: Record<string, unknown>): boolean {
	const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
	switch (tool) {
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
			return Array.isArray(args.cellIds) && args.cellIds.length > 0;
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
			getCriticalMarkdownFailures(markdown, ctx.cellOutputNames, ctx.chartedOutputNames).length > 0
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
		const mdFailures = getCriticalMarkdownFailures(markdown, ctx.cellOutputNames, ctx.chartedOutputNames);
		if (mdFailures.length > 0) {
			return `Markdown validation failed: ${mdFailures.slice(0, 3).join('; ')}. Fix Markdoc syntax and $cell refs before creating the cell.`;
		}
	}
	return null;
}
