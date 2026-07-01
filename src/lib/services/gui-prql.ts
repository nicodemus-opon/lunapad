import type {
	GUIPipelineStage,
	FromStage,
	FilterStage,
	FilterCondition,
	SelectStage,
	DeriveStage,
	DeriveExpr,
	DeriveOperand,
	DeriveColumn,
	ExprFunc,
	AggregationRow,
	GroupStage,
	GroupWindowBody,
	SortKey,
	SortStage,
	TakeStage,
	JoinStage,
	JoinCondition,
	AppendStage,
	WindowStage,
	LoopStage,
	LoopMiniStage,
	RawStage
} from '$lib/types/gui-pipeline';
import {
	PRQL_FUNCTION_REGISTRY,
	LEGACY_PRQL_FUNCTION_ALIASES,
	getPrqlFunctionArity
} from '$lib/constants/prql-functions';

const DERIVE_FUNCTION_SPECS = (() => {
	const specs: Record<ExprFunc, { minArgs: number; maxArgs: number }> = {} as Record<
		ExprFunc,
		{ minArgs: number; maxArgs: number }
	>;
	for (const fn of PRQL_FUNCTION_REGISTRY) {
		specs[fn.value] = getPrqlFunctionArity(fn.value);
	}
	for (const [legacy, canonical] of Object.entries(LEGACY_PRQL_FUNCTION_ALIASES) as Array<
		[ExprFunc, ExprFunc]
	>) {
		if (!specs[legacy]) {
			specs[legacy] = specs[canonical] ?? getPrqlFunctionArity(canonical);
		}
	}
	return specs;
})();

function isExprFunc(value: string): value is ExprFunc {
	return value in DERIVE_FUNCTION_SPECS;
}

function tokenizeSpaceSeparated(input: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let inQuote = false;
	let inBacktick = false;
	let escaped = false;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;

	for (const ch of input) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === '\\' && inQuote) {
			current += ch;
			escaped = true;
			continue;
		}
		if (ch === '`' && !inQuote) {
			inBacktick = !inBacktick;
			current += ch;
			continue;
		}
		if (ch === '"' && !inBacktick) {
			inQuote = !inQuote;
			current += ch;
			continue;
		}
		if (!inQuote && !inBacktick) {
			if (ch === '(') {
				parenDepth++;
				current += ch;
				continue;
			}
			if (ch === ')') {
				parenDepth--;
				current += ch;
				continue;
			}
			if (ch === '[') {
				bracketDepth++;
				current += ch;
				continue;
			}
			if (ch === ']') {
				bracketDepth--;
				current += ch;
				continue;
			}
			if (ch === '{') {
				braceDepth++;
				current += ch;
				continue;
			}
			if (ch === '}') {
				braceDepth--;
				current += ch;
				continue;
			}
			if (/\s/.test(ch) && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
				const token = current.trim();
				if (token) tokens.push(token);
				current = '';
				continue;
			}
		}
		current += ch;
	}

	const tail = current.trim();
	if (tail) tokens.push(tail);
	return tokens;
}

type ParseResult<T> = T | null;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip an inline `# comment` from a PRQL line, respecting double-quoted strings.
 * Returns the portion of the line before the `#`.
 */
function stripInlineComment(line: string): string {
	let inQuote = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '\\' && inQuote) {
			i++;
			continue;
		} // skip escaped char inside string
		if (ch === '"') {
			inQuote = !inQuote;
			continue;
		}
		if (ch === '#' && !inQuote) return line.slice(0, i);
	}
	return line;
}

/** Wrap a PRQL identifier in backticks if it contains characters requiring quoting. */
function quotePRQLIdent(name: string): string {
	if (!name) return name;
	if (name.startsWith('`') && name.endsWith('`')) return name; // already quoted
	if (/[^A-Za-z0-9_.]/.test(name)) return `\`${name}\``;
	return name;
}

/** Strip backtick quoting from a PRQL identifier. */
function unquotePRQLIdent(name: string): string {
	const t = name.trim();
	if (t.startsWith('`') && t.endsWith('`')) return t.slice(1, -1);
	return t;
}

/** Quote a string value for PRQL, or leave a number/bool as-is. */
function quoteValue(val: string): string {
	const trimmed = val.trim();
	// Allow underscore-separated numeric literals like 100_000
	if (/^-?\d[\d_]*(\.[\d_]+)?$/.test(trimmed)) return trimmed;
	if (trimmed === 'true' || trimmed === 'false') return trimmed;
	if (trimmed === 'null') return 'null';
	return `"${trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function unquoteValue(val: string): string {
	const trimmed = val.trim();
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	const inner = trimmed.slice(1, -1);
	return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Find the first occurrence of `sub` in `str` at paren depth 0 (ignoring matches
 * inside parentheses). Returns -1 if not found.
 */
function indexOfAtDepth0(str: string, sub: string): number {
	let depth = 0;
	for (let i = 0; i <= str.length - sub.length; i++) {
		const ch = str[i];
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
		} else if (depth === 0 && str.slice(i, i + sub.length) === sub) {
			return i;
		}
	}
	return -1;
}

/**
 * Split a comma-separated PRQL string, respecting double-quoted strings and
 * balanced parentheses (commas inside either are not treated as separators).
 */
function splitCommaSeparated(input: string): string[] {
	const parts: string[] = [];
	let current = '';
	let inQuote = false;
	let escaped = false;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;

	for (const ch of input) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			current += ch;
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inQuote = !inQuote;
			current += ch;
			continue;
		}
		if (!inQuote) {
			if (ch === '(') {
				parenDepth++;
				current += ch;
				continue;
			}
			if (ch === ')') {
				parenDepth--;
				current += ch;
				continue;
			}
			if (ch === '[') {
				bracketDepth++;
				current += ch;
				continue;
			}
			if (ch === ']') {
				bracketDepth--;
				current += ch;
				continue;
			}
			if (ch === '{') {
				braceDepth++;
				current += ch;
				continue;
			}
			if (ch === '}') {
				braceDepth--;
				current += ch;
				continue;
			}
		}
		if (ch === ',' && !inQuote && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
			const part = current.trim();
			if (part) parts.push(part);
			current = '';
			continue;
		}
		current += ch;
	}

	const tail = current.trim();
	if (tail) parts.push(tail);
	return parts;
}

/**
 * Split an expression by a delimiter at depth 0, respecting (), {}, [], and quoted strings.
 */
function splitAtDepth0(input: string, delimiter: string): string[] {
	if (!delimiter) return [input];
	const parts: string[] = [];
	let current = '';
	let inQuote = false;
	let escaped = false;
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			current += ch;
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inQuote = !inQuote;
			current += ch;
			continue;
		}
		if (!inQuote) {
			if (ch === '(') {
				parenDepth++;
				current += ch;
				continue;
			}
			if (ch === ')') {
				parenDepth--;
				current += ch;
				continue;
			}
			if (ch === '[') {
				bracketDepth++;
				current += ch;
				continue;
			}
			if (ch === ']') {
				bracketDepth--;
				current += ch;
				continue;
			}
			if (ch === '{') {
				braceDepth++;
				current += ch;
				continue;
			}
			if (ch === '}') {
				braceDepth--;
				current += ch;
				continue;
			}
		}

		if (
			!inQuote &&
			parenDepth === 0 &&
			bracketDepth === 0 &&
			braceDepth === 0 &&
			input.slice(i, i + delimiter.length) === delimiter
		) {
			const part = current.trim();
			if (part) parts.push(part);
			current = '';
			i += delimiter.length - 1;
			continue;
		}

		current += ch;
	}

	const tail = current.trim();
	if (tail) parts.push(tail);
	return parts;
}

function parseBracketList(input: string): string[] {
	const trimmed = input.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
	return splitCommaSeparated(trimmed.slice(1, -1)).map(unquoteValue);
}

function parseBraceList(input: string): string[] {
	const trimmed = input.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];
	return splitCommaSeparated(trimmed.slice(1, -1)).map((part) => part.trim());
}

function parseCollectionList(input: string): string[] {
	const trimmed = input.trim();
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) return parseBraceList(trimmed);
	if (trimmed.startsWith('[') && trimmed.endsWith(']'))
		return splitCommaSeparated(trimmed.slice(1, -1)).map((part) => part.trim());
	return [];
}

function parseOperand(token: string): DeriveOperand {
	const trimmed = token.trim();
	const isNumber = /^-?\d+(\.\d+)?$/.test(trimmed);
	const isBoolOrNull = trimmed === 'true' || trimmed === 'false' || trimmed === 'null';
	const isQuoted = trimmed.startsWith('"') && trimmed.endsWith('"');
	if (isNumber || isBoolOrNull || isQuoted) {
		return { kind: 'literal', value: unquoteValue(trimmed) };
	}
	return { kind: 'column', value: unquotePRQLIdent(trimmed) };
}

function splitPipelineStages(prql: string): ParseResult<string[]> {
	const lines = prql
		.split('\n')
		.map((line) => stripInlineComment(line).trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));

	const stages: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const startsParenBlock = /^(group|window|loop)\b/i.test(line) && line.includes('(');
		const startsAppendBlock = /^(append)\b/i.test(line) && line.includes('[');
		const startsBracketOrBraceBlock = line.match(/^(derive|select)\s*\[/) !== null;
		const startsBraceBlock = line.match(/^(derive|select|sort|aggregate)\s*\{/) !== null;

		if (startsParenBlock || startsAppendBlock || startsBracketOrBraceBlock || startsBraceBlock) {
			const block: string[] = [line];
			const openChar = startsParenBlock
				? '('
				: startsAppendBlock
					? '['
					: startsBracketOrBraceBlock
						? '['
						: '{';
			const closeChar = openChar === '(' ? ')' : openChar === '[' ? ']' : '}';
			let depth =
				(line.match(new RegExp('\\' + openChar, 'g')) ?? []).length -
				(line.match(new RegExp('\\' + closeChar, 'g')) ?? []).length;
			while (depth > 0) {
				i += 1;
				if (i >= lines.length) return null;
				const next = lines[i];
				block.push(next);
				depth +=
					(next.match(new RegExp('\\' + openChar, 'g')) ?? []).length -
					(next.match(new RegExp('\\' + closeChar, 'g')) ?? []).length;
			}
			stages.push(block.join('\n'));
			continue;
		}

		stages.push(line);
	}

	return stages;
}

function parseAppendStage(text: string): ParseResult<AppendStage> {
	const trimmed = text.trim();
	if (!trimmed.startsWith('append')) return null;

	const singleMatch = /^append\s+(.+)$/i.exec(trimmed);
	if (singleMatch && !trimmed.includes('[')) {
		const source = unquotePRQLIdent(singleMatch[1].trim());
		if (!source) return null;
		return { type: 'append', sources: [source] };
	}

	const blockMatch = /^append\s*\[([\s\S]*)\]$/i.exec(trimmed);
	if (!blockMatch) return null;

	const items = splitCommaSeparated(blockMatch[1])
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const fromMatch = /^from\s+(.+)$/i.exec(part);
			const source = fromMatch ? fromMatch[1].trim() : part;
			return unquotePRQLIdent(source);
		})
		.filter(Boolean);

	return { type: 'append', sources: items };
}

function parseAggregateStage(text: string): ParseResult<GroupStage> {
	const trimmed = text.trim();
	if (!trimmed.startsWith('aggregate')) return null;

	const singleLine = /^aggregate\s*([\[{][\s\S]*[\]}])$/i.exec(trimmed);
	if (singleLine) {
		const parts = splitCommaSeparated(singleLine[1].slice(1, -1))
			.map((line) => line.trim())
			.filter(Boolean);
		const aggregations = parseAggregateLines(parts);
		if (!aggregations) return null;
		return { type: 'group', by: [], aggregations };
	}

	const lines = trimmed
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 2) return null;
	const open = /^aggregate\s*([\[{])$/i.exec(lines[0]);
	if (!open) return null;
	const closeChar = open[1] === '[' ? ']' : '}';
	const closingIdx = lines.findIndex((line, idx) => idx > 0 && line === closeChar);
	if (closingIdx === -1 || closingIdx !== lines.length - 1) return null;

	const aggLines = lines
		.slice(1, closingIdx)
		.map((line) => line.replace(/,$/, '').trim())
		.filter(Boolean);
	const aggregations = parseAggregateLines(aggLines);
	if (!aggregations) return null;
	return { type: 'group', by: [], aggregations };
}

function parseFromStage(text: string): ParseResult<FromStage> {
	const match = /^from\s+(.+)$/i.exec(text.trim());
	if (!match) return null;
	const token = match[1].trim();
	const aliasMatch = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(token);
	if (aliasMatch)
		return { type: 'from', table: unquotePRQLIdent(aliasMatch[2].trim()), alias: aliasMatch[1] };
	return { type: 'from', table: unquotePRQLIdent(token) };
}

function parseFilterCondition(text: string): ParseResult<FilterCondition> {
	let trimmed = text.trim();

	const isNullMatch = /^(.+)\s*==\s*null$/i.exec(trimmed);
	if (isNullMatch) {
		return { column: unquotePRQLIdent(isNullMatch[1].trim()), op: 'is null', value: '' };
	}

	const isNotNullMatch = /^(.+)\s*!=\s*null$/i.exec(trimmed);
	if (isNotNullMatch) {
		return { column: unquotePRQLIdent(isNotNullMatch[1].trim()), op: 'is not null', value: '' };
	}

	const inMatch = /^\((.+)\s*\|\s*in\s*(\[.*\])\)$/i.exec(trimmed);
	if (inMatch) {
		const values = parseBracketList(inMatch[2]).join(', ');
		return { column: unquotePRQLIdent(inMatch[1].trim()), op: 'in', value: values };
	}

	const notInMatch = /^!\((.+)\s*\|\s*in\s*(\[.*\])\)$/i.exec(trimmed);
	if (notInMatch) {
		const values = parseBracketList(notInMatch[2]).join(', ');
		return { column: unquotePRQLIdent(notInMatch[1].trim()), op: 'not in', value: values };
	}

	// Allow harmless wrapper parens around simple conditions: (a > 1)
	while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
		let depth = 0;
		let wrapsWhole = true;
		for (let i = 0; i < trimmed.length; i++) {
			const ch = trimmed[i];
			if (ch === '(') depth++;
			if (ch === ')') depth--;
			if (depth === 0 && i < trimmed.length - 1) {
				wrapsWhole = false;
				break;
			}
		}
		if (!wrapsWhole) break;
		trimmed = trimmed.slice(1, -1).trim();
	}

	const binaryMatch = /^(.+?)\s*(==|!=|>=|<=|>|<|like)\s*(.+)$/i.exec(trimmed);
	if (!binaryMatch) return null;

	const rawValue = binaryMatch[3].trim();
	// Reject if the value itself contains compound logic at depth 0 — indicates a mis-parse where
	// the regex grabbed multiple conditions as one (e.g. LLM-generated SQL-style AND without outer parens)
	if (
		splitAtDepth0(rawValue, '&&').length > 1 ||
		splitAtDepth0(rawValue, '||').length > 1 ||
		splitAtDepth0(rawValue, ' AND ').length > 1 ||
		splitAtDepth0(rawValue, ' OR ').length > 1
	)
		return null;
	// Preserve PRQL date/timestamp literals that start with @
	const value = rawValue.startsWith('@') ? rawValue : unquoteValue(rawValue);
	return {
		column: unquotePRQLIdent(binaryMatch[1].trim()),
		op: binaryMatch[2] as FilterCondition['op'],
		value
	};
}

function parseFilterStage(text: string): ParseResult<FilterStage> {
	const trimmed = text.trim();
	if (!trimmed.startsWith('filter ')) return null;
	const expr = trimmed.slice('filter '.length).trim();

	const tryMultiCondition = (input: string): ParseResult<FilterStage> => {
		for (const [andOp, orOp] of [
			['&&', '||'],
			[' AND ', ' OR ']
		] as const) {
			const orParts = splitAtDepth0(input, orOp);
			const andParts = splitAtDepth0(input, andOp);
			const logic: FilterStage['logic'] = orParts.length > 1 ? 'or' : 'and';
			const parts = (logic === 'or' ? orParts : andParts)
				.map((part) => part.trim())
				.filter(Boolean);
			if (parts.length <= 1) continue;
			const conditions = parts.map(parseFilterCondition);
			if (conditions.some((c) => c === null)) continue;
			return { type: 'filter', logic, conditions: conditions as FilterCondition[] };
		}
		return null;
	};

	if (expr.startsWith('(') && expr.endsWith(')')) {
		const inner = expr.slice(1, -1);
		const result = tryMultiCondition(inner);
		if (result) return result;
	}

	// Also try at top level to handle: filter A >= x && B <= y (no outer parens)
	const topResult = tryMultiCondition(expr);
	if (topResult) return topResult;

	const condition = parseFilterCondition(expr);
	if (!condition) return null;
	return { type: 'filter', logic: 'and', conditions: [condition] };
}

function parseSelectStage(text: string): ParseResult<SelectStage> {
	const trimmed = text.trim();
	// Block form: select { col1, col2, ... } or select [col1, col2, ...]
	const blockMatch = /^select\s*([\[{][\s\S]*[\]}])$/i.exec(trimmed);
	if (blockMatch)
		return { type: 'select', columns: parseCollectionList(blockMatch[1]).map(unquotePRQLIdent) };
	// Single-column form: select col (but not select *)
	const singleMatch = /^select\s+([^{*\s]\S*)$/i.exec(trimmed);
	if (singleMatch) return { type: 'select', columns: [unquotePRQLIdent(singleMatch[1])] };
	return null;
}

function parseDeriveExpr(expr: string): DeriveExpr {
	const trimmed = expr.trim();

	// f-string: f"""..."""
	if (trimmed.startsWith('f"""') && trimmed.endsWith('"""')) {
		return { mode: 'fstring', template: trimmed.slice(4, -3) };
	}

	// s-string: s"""..."""
	if (trimmed.startsWith('s"""') && trimmed.endsWith('"""')) {
		return { mode: 'sstring', template: trimmed.slice(4, -3) };
	}

	// f-string: f"..."
	if (trimmed.startsWith('f"') && trimmed.endsWith('"')) {
		return { mode: 'fstring', template: unquoteValue(trimmed.slice(1)) };
	}

	// s-string: s"..."
	if (trimmed.startsWith('s"') && trimmed.endsWith('"')) {
		return { mode: 'sstring', template: unquoteValue(trimmed.slice(1)) };
	}

	const funcTokens = tokenizeSpaceSeparated(trimmed);
	if (funcTokens.length > 0) {
		const [maybeFunc, ...argTokens] = funcTokens;
		if (isExprFunc(maybeFunc)) {
			const spec = DERIVE_FUNCTION_SPECS[maybeFunc];
			if (argTokens.length >= spec.minArgs && argTokens.length <= spec.maxArgs) {
				return {
					mode: 'func',
					func: maybeFunc,
					args: argTokens.map(parseOperand)
				};
			}
		}
	}

	for (const op of ['||', '+', '-', '*', '/'] as const) {
		const marker = ` ${op} `;
		const idx = indexOfAtDepth0(trimmed, marker);
		if (idx === -1) continue;
		const left = trimmed.slice(0, idx).trim();
		const right = trimmed.slice(idx + marker.length).trim();
		if (!left || !right) continue;
		// Skip if either operand is a sub-expression (contains parens)
		if (left.includes('(') || right.includes('(')) continue;
		return {
			mode: 'binary',
			left: parseOperand(left),
			op,
			right: parseOperand(right)
		};
	}

	// Fallback: raw expression (preserves round-trip for anything we can't parse structurally)
	return { mode: 'raw', expr: trimmed };
}

function parseDeriveStage(text: string): ParseResult<DeriveStage> {
	const trimmed = text.trim();

	// Single derive without braces: `derive name = expr` (name may be backtick-quoted)
	const singleMatch = /^derive\s+(`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/i.exec(trimmed);
	if (singleMatch) {
		const name = unquotePRQLIdent(singleMatch[1].trim());
		const expr = parseDeriveExpr(singleMatch[2].trim());
		return { type: 'derive', columns: [{ name, expr }] };
	}

	// Multi-derive: `derive { name = expr, ... }` or `derive [ name = expr, ... ]`
	const body = trimmed.slice('derive'.length).trim();
	const openChar = body[0];
	const closeChar = body[body.length - 1];
	if (!((openChar === '{' && closeChar === '}') || (openChar === '[' && closeChar === ']'))) {
		return null;
	}
	const parts = splitCommaSeparated(body.slice(1, -1));
	const columns = parts.map((part) => {
		const assignMatch = /^(`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/i.exec(part.trim());
		if (!assignMatch) return null;
		const name = unquotePRQLIdent(assignMatch[1].trim());
		const exprText = assignMatch[2].trim();
		if (!name) return null;
		return { name, expr: parseDeriveExpr(exprText) };
	});
	if (columns.some((c) => c === null)) return null;
	return { type: 'derive', columns: columns as DeriveStage['columns'] };
}

function parseSortStage(text: string): ParseResult<SortStage> {
	const trimmed = text.trim();
	const listText =
		/^sort\s*(\{[\s\S]*\})$/i.exec(trimmed)?.[1] ??
		/^sort\s*(\[[\s\S]*\])$/i.exec(trimmed)?.[1] ??
		/^sort\s+(.+)$/i.exec(trimmed)?.[1];
	if (!listText) return null;
	const listTrimmed = listText.trim();
	const rawKeys = listTrimmed.startsWith('{')
		? parseBraceList(listText)
		: listTrimmed.startsWith('[')
			? splitCommaSeparated(listTrimmed.slice(1, -1))
			: [listTrimmed];
	const keys = rawKeys.map((key) => {
		if (key.startsWith('-')) {
			return { column: unquotePRQLIdent(key.slice(1)), dir: 'desc' as const };
		}
		return { column: unquotePRQLIdent(key), dir: 'asc' as const };
	});
	return { type: 'sort', keys };
}

function parseTakeStage(text: string): ParseResult<TakeStage> {
	const trimmed = text.trim();
	// Range expression: take N..M
	const rangeMatch = /^take\s+(\d+)\.\.(\d+)$/i.exec(trimmed);
	if (rangeMatch) {
		return { type: 'take', rangeFrom: Number(rangeMatch[1]), n: Number(rangeMatch[2]) };
	}
	const match = /^take\s+(\d+)$/i.exec(trimmed);
	if (!match) return null;
	return { type: 'take', n: Number(match[1]) };
}

function parseJoinStage(text: string): ParseResult<JoinStage> {
	// join [side:type] [alias=]table (conditions)
	const match = /^join\s+(?:(?:side:(inner|left|right|full))\s+)?([^\s(]+)\s+\(([\s\S]*)\)$/i.exec(
		text.trim()
	);
	if (!match) return null;
	const joinType = (match[1]?.toLowerCase() as JoinStage['joinType'] | undefined) ?? 'inner';
	const tableToken = match[2];
	const condText = match[3].trim();

	// Detect alias: `c=customers`
	let alias: string | undefined;
	let table: string;
	const aliasMatch = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(tableToken);
	if (aliasMatch) {
		alias = aliasMatch[1];
		table = aliasMatch[2];
	} else {
		table = tableToken;
	}

	const ref = alias ?? table; // prefix used in full column refs
	const columnPattern = /^(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_.]*)$/;

	const conditions: JoinCondition[] =
		condText === 'true'
			? []
			: splitAtDepth0(condText, '&&').flatMap((cond) => {
					const c = cond.trim();

					// Shorthand: `==column`
					const shorthandMatch = /^==(.+)$/.exec(c);
					if (shorthandMatch) {
						const col = unquotePRQLIdent(shorthandMatch[1].trim());
						return [{ left: col, right: col, shorthand: true }];
					}

					// PRQL also allows same-column join shorthand as `(column)`.
					if (columnPattern.test(c)) {
						const col = unquotePRQLIdent(c);
						return [{ left: col, right: col, shorthand: true }];
					}

					// Standard: `left == ref.right` or `left == right`
					const condMatch = /^(.+?)\s*==\s*(.+)$/.exec(c);
					if (!condMatch) return [];
					const left = condMatch[1].trim();
					const rightFull = condMatch[2].trim();
					const prefix = `${ref}.`;
					const right = rightFull.startsWith(prefix) ? rightFull.slice(prefix.length) : rightFull;
					return [{ left, right }];
				});

	return { type: 'join', joinType, table, alias, conditions };
}

/**
 * Parse derive column entries from a flat list of trimmed, non-empty assignment strings.
 * e.g. ["avg = average col", "total = sum col"]
 */
function parseDeriveColumnParts(parts: string[]): DeriveColumn[] | null {
	const columns = parts.map((part) => {
		const assignMatch = /^(`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/i.exec(part.trim());
		if (!assignMatch) return null;
		const name = unquotePRQLIdent(assignMatch[1].trim());
		const exprText = assignMatch[2].trim();
		if (!name) return null;
		return { name, expr: parseDeriveExpr(exprText) };
	});
	if (columns.some((c) => c === null)) return null;
	return columns as DeriveColumn[];
}

function parseAggregationLine(line: string): AggregationRow | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const colPattern = '(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_.]*)';

	const withAlias = new RegExp(
		`^( |\`[^\`]+\`|[A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(count_distinct|count|sum|avg|average|min|max|first|last|stddev|all|any|concat_array)(?:\\s+(${colPattern}))?$`.replace(
			'^\(\u0000\|',
			'^('
		),
		'i'
	).exec(trimmed);
	if (withAlias) {
		const name = unquotePRQLIdent(withAlias[1].trim());
		const func = withAlias[2].toLowerCase() as GroupStage['aggregations'][number]['func'];
		const parsedColumn = unquotePRQLIdent((withAlias[3] ?? '').trim());
		const column = func === 'count' && parsedColumn === 'this' ? '' : parsedColumn;
		return { name, func, column };
	}

	const noAlias = new RegExp(
		`^(count_distinct|count|sum|avg|average|min|max|first|last|stddev|all|any|concat_array)(?:\\s+(${colPattern}))?$`,
		'i'
	).exec(trimmed);
	if (noAlias) {
		const func = noAlias[1].toLowerCase() as GroupStage['aggregations'][number]['func'];
		const parsedColumn = unquotePRQLIdent((noAlias[2] ?? '').trim());
		const column = func === 'count' && parsedColumn === 'this' ? '' : parsedColumn;
		return { name: '', func, column };
	}

	const rawWithAlias = /^(`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/i.exec(trimmed);
	if (rawWithAlias) {
		return {
			name: unquotePRQLIdent(rawWithAlias[1].trim()),
			func: 'raw',
			column: '',
			expr: rawWithAlias[2].trim()
		};
	}

	return { name: '', func: 'raw', column: '', expr: trimmed };
}

function parseAggregateLines(lines: string[]): AggregationRow[] | null {
	const aggregations = lines.map(parseAggregationLine);
	if (aggregations.some((agg) => agg === null)) return null;
	return aggregations as AggregationRow[];
}

/**
 * Parse a window-style group body: optional `sort {…}` followed by `derive {…}`.
 * `bodyLines` are the trimmed non-empty lines between the outer `(` and `)` of the group.
 */
function parseWindowGroupBody(bodyLines: string[], by: string[]): ParseResult<GroupStage> {
	let i = 0;
	let sortKeys: SortKey[] = [];

	// Optional single-line sort: sort {col, ...} or sort col
	if (i < bodyLines.length && /^sort\b/.test(bodyLines[i])) {
		const parsed = parseSortStage(bodyLines[i]);
		if (!parsed) return null;
		sortKeys = parsed.keys;
		i++;
	}

	// Must have a derive block
	if (i >= bodyLines.length || !/^derive\s*[\[{]/.test(bodyLines[i])) return null;

	// Single-line derive: derive {col = expr, ...} or derive [col = expr, ...]
	const singleLine = /^derive\s*([\[{].*[\]}])$/i.exec(bodyLines[i]);
	if (singleLine) {
		i++;
		if (i !== bodyLines.length) return null;
		const parts = splitCommaSeparated(singleLine[1].slice(1, -1))
			.map((s) => s.trim())
			.filter(Boolean);
		const derives = parseDeriveColumnParts(parts);
		if (!derives) return null;
		return { type: 'group', by, aggregations: [], window: { sortKeys, derives } };
	}

	// Multi-line derive: collect inner lines until closing ] or }
	const deriveOpen = /^derive\s*([\[{])$/i.exec(bodyLines[i]);
	if (!deriveOpen) return null;
	const deriveClose = deriveOpen[1] === '[' ? ']' : '}';
	i++; // skip "derive {"
	const innerLines: string[] = [];
	while (i < bodyLines.length && bodyLines[i] !== deriveClose) {
		innerLines.push(bodyLines[i]);
		i++;
	}
	if (i >= bodyLines.length) return null; // no closing }
	i++; // skip "}"
	if (i !== bodyLines.length) return null; // unexpected trailing content

	// Join with space so multi-line expressions (e.g. z = (\n  a - b\n) / c) become one line
	const joined = innerLines.join(' ');
	const parts = splitCommaSeparated(joined)
		.map((s) => s.trim())
		.filter(Boolean);
	const derives = parseDeriveColumnParts(parts);
	if (!derives) return null;

	return { type: 'group', by, aggregations: [], window: { sortKeys, derives } };
}

function parseGroupStage(text: string): ParseResult<GroupStage> {
	// Compact single-line form emitted by LLMs:
	//   group {col1, col2} (aggregate {name = func col, ...})
	//   group col (aggregate {name = func col})
	const compact =
		/^group\s+(\{[^}]*\}|`[^`]+`|[A-Za-z_][A-Za-z0-9_.]*)\s*\(\s*aggregate\s*(\{[^}]*\})\s*\)$/i.exec(
			text.trim()
		);
	if (compact) {
		const byPart = compact[1].trim();
		const by = byPart.startsWith('{')
			? parseBraceList(byPart).map(unquotePRQLIdent)
			: [unquotePRQLIdent(byPart)];
		const aggParts = splitCommaSeparated(compact[2].slice(1, -1))
			.map((s) => s.trim())
			.filter(Boolean);
		const aggregations = parseAggregateLines(aggParts);
		if (!aggregations) return null;
		return { type: 'group', by, aggregations };
	}

	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 3) return null;

	// Support both `group {col1, col2} (` and `group single_col (` (with optional backtick-quoting)
	const headBraced = /^group\s+(\{.*\})\s*\($/i.exec(lines[0]);
	const headSingle = /^group\s+(`[^`]+`|[A-Za-z_][A-Za-z0-9_.]*)\s*\($/i.exec(lines[0]);
	let by: string[];
	if (headBraced) {
		by = parseBraceList(headBraced[1]).map(unquotePRQLIdent);
	} else if (headSingle) {
		by = [unquotePRQLIdent(headSingle[1])];
	} else {
		return null;
	}

	// Last line must be the closing paren
	if (lines[lines.length - 1] !== ')') return null;
	const bodyLines = lines.slice(1, -1);

	// Empty aggregate: group x (\n  aggregate {}\n)
	if (bodyLines.length === 1 && /^aggregate\s*[\[{]\s*[\]}]\s*$/i.test(bodyLines[0])) {
		return { type: 'group', by, aggregations: [] };
	}

	const singleLineAggregate =
		bodyLines.length === 1 ? /^aggregate\s*([\[{][\s\S]*[\]}])$/i.exec(bodyLines[0]) : null;
	if (singleLineAggregate) {
		const parts = splitCommaSeparated(singleLineAggregate[1].slice(1, -1))
			.map((line) => line.trim())
			.filter(Boolean);
		const aggregations = parseAggregateLines(parts);
		if (!aggregations) return null;
		return { type: 'group', by, aggregations };
	}

	// Standard aggregate body
	const aggregateOpen = bodyLines.length >= 2 ? /^aggregate\s*([\[{])$/i.exec(bodyLines[0]) : null;
	if (aggregateOpen) {
		const closeChar = aggregateOpen[1] === '[' ? ']' : '}';
		const closingIdx = bodyLines.findIndex((line, idx) => idx > 0 && line === closeChar);
		if (closingIdx === -1) return null;
		if (closingIdx !== bodyLines.length - 1) return null;

		const aggLines = bodyLines
			.slice(1, closingIdx)
			.map((line) => line.replace(/,$/, '').trim())
			.filter(Boolean);

		const aggregations = parseAggregateLines(aggLines);
		if (!aggregations) return null;
		return { type: 'group', by, aggregations };
	}

	// Window body: sort + derive
	const singleTake = bodyLines.length === 1 ? /^take\s+(\d+)$/i.exec(bodyLines[0]) : null;
	if (singleTake) {
		return { type: 'group', by, aggregations: [], take: Number(singleTake[1]) };
	}

	return parseWindowGroupBody(bodyLines, by);
}

function parseWindowStage(text: string): ParseResult<WindowStage> {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 3) return null;

	const head = /^window\s+(.+)\s*\($/i.exec(lines[0]);
	if (!head) return null;
	if (lines[lines.length - 1] !== ')') return null;

	const bodyLines = lines.slice(1, -1);
	const parsedBody = parseWindowGroupBody(bodyLines, []);
	if (!parsedBody?.window) return null;

	return {
		type: 'window',
		frame: head[1].trim(),
		sortKeys: parsedBody.window.sortKeys,
		derives: parsedBody.window.derives
	};
}

function parseLoopStage(text: string): ParseResult<LoopStage> {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 3) return null;
	if (!/^loop\s*\($/i.test(lines[0])) return null;
	if (lines[lines.length - 1] !== ')') return null;
	const body = lines.slice(1, -1).join('\n').trim();
	if (!body) return null;
	const structuredBody = parseLoopBodyToMiniStages(body);
	if (structuredBody && structuredBody.length > 0) {
		return { type: 'loop', body, mode: 'structured', structuredBody };
	}
	return { type: 'loop', body };
}

function isLoopMiniStage(stage: GUIPipelineStage): stage is LoopMiniStage {
	return (
		stage.type === 'filter' ||
		stage.type === 'select' ||
		stage.type === 'derive' ||
		stage.type === 'sort' ||
		stage.type === 'take'
	);
}

export function parseLoopBodyToMiniStages(body: string): LoopMiniStage[] | null {
	const blocks = splitPipelineStages(body);
	if (!blocks || blocks.length === 0) return null;

	const stages: LoopMiniStage[] = [];
	for (const block of blocks) {
		const parsed = parseStage(block);
		if (!parsed || !isLoopMiniStage(parsed)) return null;
		stages.push(parsed);
	}

	return stages;
}

export function loopMiniStagesToBody(stages: LoopMiniStage[]): string {
	return stages.map((stage) => stageToPreql(stage)).join('\n');
}

function parseStage(text: string): ParseResult<GUIPipelineStage> {
	const trimmed = text.trim();
	if (trimmed.startsWith('from ')) return parseFromStage(trimmed);
	if (trimmed.startsWith('append')) return parseAppendStage(trimmed);
	if (trimmed.startsWith('filter ')) return parseFilterStage(trimmed);
	if (trimmed.startsWith('select ')) return parseSelectStage(trimmed);
	if (trimmed.startsWith('derive ')) return parseDeriveStage(trimmed);
	if (trimmed.startsWith('aggregate')) return parseAggregateStage(trimmed);
	if (trimmed.startsWith('group ')) return parseGroupStage(trimmed);
	if (trimmed.startsWith('window ')) return parseWindowStage(trimmed);
	if (trimmed.startsWith('loop ')) return parseLoopStage(trimmed);
	if (trimmed.startsWith('sort ')) return parseSortStage(trimmed);
	if (trimmed.startsWith('take ')) return parseTakeStage(trimmed);
	if (trimmed.startsWith('join ')) return parseJoinStage(trimmed);
	return null;
}

function operandToPreql(op: DeriveOperand): string {
	return op.kind === 'column' ? quotePRQLIdent(op.value) : quoteValue(op.value);
}

// ── Stage generators ─────────────────────────────────────────────────────────

function fromToPreql(s: FromStage): string {
	if (!s.table) return '# select a source table';
	const quotedTable = quotePRQLIdent(s.table);
	return s.alias ? `from ${s.alias}=${quotedTable}` : `from ${quotedTable}`;
}

function appendToPreql(s: AppendStage): string {
	if (s.sources.length === 0) return 'append []';
	const sources = s.sources
		.filter((source) => source.trim().length > 0)
		.map((source) => quotePRQLIdent(source));
	if (sources.length === 0) return 'append []';
	if (sources.length === 1) return `append ${sources[0]}`;
	return sources.map((source) => `append ${source}`).join('\n');
}

function filterCondToPreql(cond: FilterCondition): string {
	const { column, op, value } = cond;
	const col = quotePRQLIdent(column);
	if (op === 'is null') return `${col} == null`;
	if (op === 'is not null') return `${col} != null`;
	if (op === 'in' || op === 'not in') {
		const vals = value
			.split(',')
			.map((v) => quoteValue(v.trim()))
			.join(', ');
		const prefix = op === 'not in' ? '!' : '';
		return `${prefix}(${col} | in [${vals}])`;
	}
	// Preserve PRQL date/time literals and other @ values as-is
	const quotedVal = value.startsWith('@') ? value : quoteValue(value);
	return `${col} ${op} ${quotedVal}`;
}

function filterToPreql(s: FilterStage): string {
	if (s.conditions.length === 0) return '# add filter conditions';
	const parts = s.conditions.filter((c) => c.column).map(filterCondToPreql);
	if (parts.length === 0) return '# add filter conditions';
	const join = s.logic === 'and' ? ' && ' : ' || ';
	return parts.length === 1 ? `filter ${parts[0]}` : `filter (${parts.join(join)})`;
}

function selectToPreql(s: SelectStage): string {
	if (s.columns.length === 0) return '# select columns';
	return `select {${s.columns.map(quotePRQLIdent).join(', ')}}`;
}

function deriveExprToPreql(expr: DeriveExpr): string {
	if (expr.mode === 'fstring') return `f"""${expr.template}"""`;
	if (expr.mode === 'sstring') return `s"""${expr.template}"""`;
	if (expr.mode === 'raw') return expr.expr;
	if (expr.mode === 'func') {
		const funcExpr = expr as DeriveExpr & { args?: DeriveOperand[]; arg?: DeriveOperand };
		const operands = Array.isArray(funcExpr.args)
			? funcExpr.args
			: funcExpr.arg
				? [funcExpr.arg]
				: [];
		return operands.length === 0
			? expr.func
			: [expr.func, ...operands.map(operandToPreql)].join(' ');
	}
	return `${operandToPreql(expr.left)} ${expr.op} ${operandToPreql(expr.right)}`;
}

function deriveToPreql(s: DeriveStage): string {
	if (s.columns.length === 0) return '# add derived columns';
	const named = s.columns.filter((c) => c.name);
	if (named.length === 1) {
		// Single column: no braces (matches PRQL idiom)
		return `derive ${quotePRQLIdent(named[0].name)} = ${deriveExprToPreql(named[0].expr)}`;
	}
	const cols = named
		.map((c) => `  ${quotePRQLIdent(c.name)} = ${deriveExprToPreql(c.expr)}`)
		.join(',\n');
	return `derive {\n${cols}\n}`;
}

function groupToPreql(s: GroupStage): string {
	if (s.by.length === 0 && !s.window) {
		if (s.aggregations.length === 0) {
			return 'aggregate {}';
		}
		const aggLines = s.aggregations
			.filter((a) =>
				a.func === 'raw' ? Boolean(a.expr?.trim()) : Boolean(a.column || a.func === 'count')
			)
			.map((a) => {
				if (a.func === 'raw') {
					const expr = a.expr?.trim() ?? '';
					return a.name ? `  ${quotePRQLIdent(a.name)} = ${expr}` : `  ${expr}`;
				}
				const colArg = a.column ? ` ${quotePRQLIdent(a.column)}` : '';
				const funcExpr =
					a.func === 'count_distinct'
						? `count_distinct${colArg}`
						: a.func === 'count' && !a.column
							? 'count this'
							: `${a.func}${colArg}`;
				return a.name ? `  ${quotePRQLIdent(a.name)} = ${funcExpr}` : `  ${funcExpr}`;
			});
		return `aggregate {\n${aggLines.join(',\n')}\n}`;
	}

	const byStr =
		s.by.length === 1 ? quotePRQLIdent(s.by[0]) : `{${s.by.map(quotePRQLIdent).join(', ')}}`;

	if (!s.window && s.take !== undefined && s.by.length > 0) {
		return `group ${byStr} (\n  take ${s.take}\n)`;
	}

	if (s.window) {
		const sortLine =
			s.window.sortKeys.length > 0
				? `  sort {${s.window.sortKeys
						.map((k) =>
							k.dir === 'desc' ? `-${quotePRQLIdent(k.column)}` : quotePRQLIdent(k.column)
						)
						.join(', ')}}\n`
				: '';
		const deriveCols = s.window.derives
			.filter((d) => d.name)
			.map((d) => `    ${quotePRQLIdent(d.name)} = ${deriveExprToPreql(d.expr)}`);
		if (deriveCols.length === 0) {
			return `group ${byStr} (\n${sortLine}  derive {}\n)`;
		}
		return `group ${byStr} (\n${sortLine}  derive {\n${deriveCols.join(',\n')},\n  }\n)`;
	}

	if (s.aggregations.length === 0) {
		return `group ${byStr} (\n  aggregate {}\n)`;
	}
	const aggLines = s.aggregations
		.filter((a) =>
			a.func === 'raw' ? Boolean(a.expr?.trim()) : Boolean(a.column || a.func === 'count')
		)
		.map((a) => {
			if (a.func === 'raw') {
				const expr = a.expr?.trim() ?? '';
				return a.name ? `    ${quotePRQLIdent(a.name)} = ${expr}` : `    ${expr}`;
			}
			const colArg = a.column ? ` ${quotePRQLIdent(a.column)}` : '';
			const funcExpr =
				a.func === 'count_distinct'
					? `count_distinct${colArg}`
					: a.func === 'count' && !a.column
						? 'count this'
						: `${a.func}${colArg}`;
			return a.name ? `    ${quotePRQLIdent(a.name)} = ${funcExpr}` : `    ${funcExpr}`;
		});
	return `group ${byStr} (\n  aggregate {\n${aggLines.join(',\n')}\n  }\n)`;
}

function windowToPreql(s: WindowStage): string {
	const frame = s.frame.trim() || 'rows:-2..0';
	const sortLine =
		s.sortKeys.length > 0
			? `  sort {${s.sortKeys
					.map((k) =>
						k.dir === 'desc' ? `-${quotePRQLIdent(k.column)}` : quotePRQLIdent(k.column)
					)
					.join(', ')}}\n`
			: '';
	const deriveCols = s.derives
		.filter((d) => d.name)
		.map((d) => `    ${quotePRQLIdent(d.name)} = ${deriveExprToPreql(d.expr)}`);
	const deriveBlock =
		deriveCols.length > 0 ? `  derive {\n${deriveCols.join(',\n')},\n  }` : '  derive {}';
	return `window ${frame} (\n${sortLine}${deriveBlock}\n)`;
}

function loopToPreql(s: LoopStage): string {
	const body =
		s.mode === 'structured' && s.structuredBody && s.structuredBody.length > 0
			? loopMiniStagesToBody(s.structuredBody).trim()
			: s.body.trim();
	if (!body) return 'loop (\n  # add loop body\n)';
	return `loop (\n${body}\n)`;
}

function sortToPreql(s: SortStage): string {
	if (s.keys.length === 0) return '# add sort keys';
	const keys = s.keys
		.filter((k) => k.column)
		.map((k) => (k.dir === 'desc' ? `-${quotePRQLIdent(k.column)}` : quotePRQLIdent(k.column)))
		.join(', ');
	return `sort {${keys}}`;
}

function takeToPreql(s: TakeStage): string {
	if (s.rangeFrom !== undefined) return `take ${s.rangeFrom}..${s.n}`;
	return `take ${s.n}`;
}

function joinToPreql(s: JoinStage): string {
	if (!s.table) return '# select join table';
	const side = s.joinType !== 'inner' ? `side:${s.joinType} ` : '';
	const ref = s.alias ?? s.table;
	const quotedTable = quotePRQLIdent(s.table);
	const tableRef = s.alias ? `${s.alias}=${quotedTable}` : quotedTable;
	const conds = s.conditions
		.filter((c) => c.left || c.shorthand)
		.map((c) => {
			if (c.shorthand) {
				const col = quotePRQLIdent(c.left);
				return `${col} == ${ref}.${col}`;
			}
			return `${quotePRQLIdent(c.left)} == ${ref}.${quotePRQLIdent(c.right)}`;
		})
		.join(' && ');
	return `join ${side}${tableRef} (${conds || 'true'})`;
}

function rawToPreql(s: RawStage): string {
	return s.prql;
}

// ── Public API ────────────────────────────────────────────────────────────────

export { deriveExprToPreql, parseDeriveExpr };

export function stageToPreql(stage: GUIPipelineStage): string {
	switch (stage.type) {
		case 'from':
			return fromToPreql(stage);
		case 'append':
			return appendToPreql(stage);
		case 'filter':
			return filterToPreql(stage);
		case 'select':
			return selectToPreql(stage);
		case 'derive':
			return deriveToPreql(stage);
		case 'group':
			return groupToPreql(stage);
		case 'window':
			return windowToPreql(stage);
		case 'loop':
			return loopToPreql(stage);
		case 'sort':
			return sortToPreql(stage);
		case 'take':
			return takeToPreql(stage);
		case 'join':
			return joinToPreql(stage);
		case 'raw':
			return rawToPreql(stage);
	}
}

export function guiToPreql(stages: GUIPipelineStage[]): string {
	return stages
		.filter((s) => !s.disabled)
		.map(stageToPreql)
		.join('\n');
}

export function prqlToGuiStages(prql: string): GUIPipelineStage[] | null {
	const blocks = splitPipelineStages(prql);
	if (!blocks) return null;
	if (blocks.length === 0) return [];

	const stages: GUIPipelineStage[] = [];
	for (const block of blocks) {
		const stage = parseStage(block);
		if (stage?.type === 'append') {
			const prev = stages[stages.length - 1];
			if (prev?.type === 'append') {
				prev.sources = [...prev.sources, ...stage.sources];
				continue;
			}
		}
		// Fall back to a raw stage for valid PRQL the GUI can't parse structurally
		stages.push(stage ?? { type: 'raw', prql: block.trim() });
	}

	return stages;
}

/**
 * Merge parsed visible stages back into a previous GUI pipeline that may include
 * hidden/disabled stages. Disabled stages keep their original positions unless
 * explicitly removed in GUI.
 */
export function mergeParsedWithHiddenStages(
	previousStages: GUIPipelineStage[],
	parsedStages: GUIPipelineStage[]
): GUIPipelineStage[] {
	if (!previousStages.some((s) => s.disabled)) return parsedStages;

	const merged: GUIPipelineStage[] = [];
	let parsedIdx = 0;

	for (const prev of previousStages) {
		if (prev.disabled) {
			merged.push(prev);
			continue;
		}
		if (parsedIdx < parsedStages.length) {
			merged.push(parsedStages[parsedIdx]);
			parsedIdx += 1;
		}
	}

	while (parsedIdx < parsedStages.length) {
		merged.push(parsedStages[parsedIdx]);
		parsedIdx += 1;
	}

	return merged;
}

/**
 * Returns columns available at `upToIndex` (i.e. produced by all stages before it).
 * `tableSchemas` maps table/view names to their column arrays.
 */
export function getAvailableColumns(
	stages: GUIPipelineStage[],
	tableSchemas: Record<string, string[]>,
	upToIndex: number
): string[] {
	let cols: string[] = [];
	for (let i = 0; i < upToIndex && i < stages.length; i++) {
		const stage = stages[i];
		if (stage.disabled) continue;
		switch (stage.type) {
			case 'from':
				cols = tableSchemas[stage.table] ?? [];
				break;
			case 'append':
				break;
			case 'select':
				cols = stage.columns.length ? stage.columns : cols;
				break;
			case 'derive':
				cols = [...cols, ...stage.columns.map((c) => c.name).filter(Boolean)];
				break;
			case 'group':
				if (stage.window) {
					cols = [...stage.by, ...stage.window.derives.map((d) => d.name).filter(Boolean)];
				} else if (stage.take !== undefined) {
					cols = [...stage.by];
				} else {
					cols = [...stage.by, ...stage.aggregations.map((a) => a.name).filter(Boolean)];
				}
				break;
			case 'window':
				cols = [...cols, ...stage.derives.map((d) => d.name).filter(Boolean)];
				break;
			case 'loop':
				break;
			case 'join': {
				const prefix = stage.alias ?? stage.table;
				const joinCols = (tableSchemas[stage.table] ?? []).map((c) => `${prefix}.${c}`);
				cols = [...cols, ...joinCols];
				break;
			}
			// filter, sort, take, raw — pass-through
		}
	}
	return cols;
}

/** Convenience: all unique columns at index `stages.length` (end of pipeline). */
export function getFinalColumns(
	stages: GUIPipelineStage[],
	tableSchemas: Record<string, string[]>
): string[] {
	return getAvailableColumns(stages, tableSchemas, stages.length);
}

function deriveExprReferencesAvailableColumns(
	expr: DeriveExpr,
	availableColumns: Set<string>
): boolean {
	if (expr.mode === 'binary') {
		const leftOk = expr.left.kind === 'literal' || availableColumns.has(expr.left.value);
		const rightOk = expr.right.kind === 'literal' || availableColumns.has(expr.right.value);
		return leftOk && rightOk;
	}

	if (expr.mode === 'func') {
		return expr.args.every((arg) => arg.kind === 'literal' || availableColumns.has(arg.value));
	}

	return false;
}

export function reconcileStagesAfterSourceChange(
	stages: GUIPipelineStage[],
	tableSchemas: Record<string, string[]>
): GUIPipelineStage[] {
	if (stages.length === 0) return stages;
	const [firstStage, ...rest] = stages;
	if (firstStage.type !== 'from') return stages;

	let availableColumns = [...(tableSchemas[firstStage.table] ?? [])];
	const nextStages: GUIPipelineStage[] = [firstStage];

	for (const stage of rest) {
		if (stage.disabled) {
			nextStages.push(stage);
			continue;
		}

		const availableSet = new Set(availableColumns);

		switch (stage.type) {
			case 'filter': {
				const conditions = stage.conditions.filter((condition) =>
					availableSet.has(condition.column)
				);
				if (conditions.length > 0) nextStages.push({ ...stage, conditions });
				break;
			}
			case 'select': {
				const columns = stage.columns.filter((column) => availableSet.has(column));
				if (columns.length === 0) break;
				nextStages.push({ ...stage, columns });
				availableColumns = columns;
				break;
			}
			case 'derive': {
				const columns = stage.columns.filter((column) =>
					deriveExprReferencesAvailableColumns(column.expr, availableSet)
				);
				if (columns.length === 0) break;
				nextStages.push({ ...stage, columns });
				availableColumns = [
					...availableColumns,
					...columns.map((column) => column.name).filter(Boolean)
				];
				break;
			}
			case 'group': {
				if (stage.window) {
					const allByAvailable = stage.by.every((column) => availableSet.has(column));
					const allSortKeysAvailable = stage.window.sortKeys.every((key) =>
						availableSet.has(key.column)
					);
					const derives = stage.window.derives.filter((column) =>
						deriveExprReferencesAvailableColumns(column.expr, availableSet)
					);
					if (
						!allByAvailable ||
						!allSortKeysAvailable ||
						derives.length !== stage.window.derives.length
					)
						break;
					nextStages.push({ ...stage, window: { ...stage.window, derives } });
					availableColumns = [...stage.by, ...derives.map((column) => column.name).filter(Boolean)];
					break;
				}

				if (stage.take !== undefined) {
					const allByAvailable = stage.by.every((column) => availableSet.has(column));
					if (!allByAvailable) break;
					nextStages.push(stage);
					availableColumns = [...stage.by];
					break;
				}

				const by = stage.by.filter((column) => availableSet.has(column));
				const aggregations = stage.aggregations.filter((aggregation) => {
					if (aggregation.func === 'raw') return false;
					if (aggregation.func === 'count' && !aggregation.column) return true;
					return availableSet.has(aggregation.column);
				});
				if (stage.by.length > 0 && by.length === 0) break;
				if (by.length === 0 && aggregations.length === 0) break;
				nextStages.push({ ...stage, by, aggregations });
				availableColumns = [
					...by,
					...aggregations.map((aggregation) => aggregation.name).filter(Boolean)
				];
				break;
			}
			case 'sort': {
				const keys = stage.keys.filter((key) => availableSet.has(key.column));
				if (keys.length > 0) nextStages.push({ ...stage, keys });
				break;
			}
			case 'take':
				nextStages.push(stage);
				break;
			case 'append':
				nextStages.push(stage);
				break;
			case 'window': {
				const allSortKeysAvailable = stage.sortKeys.every((key) => availableSet.has(key.column));
				const derives = stage.derives.filter((column) =>
					deriveExprReferencesAvailableColumns(column.expr, availableSet)
				);
				if (!allSortKeysAvailable || derives.length !== stage.derives.length) break;
				nextStages.push({ ...stage, derives });
				availableColumns = [
					...availableColumns,
					...derives.map((column) => column.name).filter(Boolean)
				];
				break;
			}
			case 'loop':
				nextStages.push(stage);
				break;
			case 'join': {
				const rightColumns = new Set(
					(tableSchemas[stage.table] ?? []).map((column) => column.trim())
				);
				const conditions = stage.conditions.filter(
					(condition) => availableSet.has(condition.left) && rightColumns.has(condition.right)
				);
				if (conditions.length === 0) break;
				nextStages.push({ ...stage, conditions });
				const prefix = stage.alias ?? stage.table;
				availableColumns = [
					...availableColumns,
					...(tableSchemas[stage.table] ?? []).map((column) => `${prefix}.${column}`)
				];
				break;
			}
			case 'raw':
				break;
			case 'from':
				nextStages.push(stage);
				availableColumns = [...(tableSchemas[stage.table] ?? [])];
				break;
		}
	}

	return nextStages;
}

function pickFallbackSortColumn(availableColumns: string[], missingColumn: string): string | null {
	const candidates = availableColumns.filter((column) => column !== missingColumn);
	if (candidates.length === 0) return null;
	return (
		candidates.find((column) =>
			/^(sum|avg|average|min|max|pct|rolling)_|_count$|_sum$|_avg$|row_count|amount|price|cost|balance|paid|withdrawn|score|rate|ratio|total/i.test(
				column
			)
		) ??
		candidates[candidates.length - 1] ??
		null
	);
}

export function reconcileStageSequenceToAvailableColumns(
	stages: Exclude<GUIPipelineStage, { type: 'raw' }>[],
	initialAvailableColumns: string[]
): Exclude<GUIPipelineStage, { type: 'raw' }>[] {
	let availableColumns = [...initialAvailableColumns];
	const nextStages: Exclude<GUIPipelineStage, { type: 'raw' }>[] = [];

	for (const stage of stages) {
		const availableSet = new Set(availableColumns);

		switch (stage.type) {
			case 'filter': {
				const conditions = stage.conditions.filter((condition) =>
					availableSet.has(condition.column)
				);
				if (conditions.length === 0) break;
				nextStages.push({ ...stage, conditions });
				break;
			}
			case 'select': {
				const columns = stage.columns.filter((column) => availableSet.has(column));
				if (columns.length === 0) break;
				nextStages.push({ ...stage, columns });
				availableColumns = columns;
				break;
			}
			case 'derive': {
				// sstring/fstring embed raw SQL whose column refs can't be parsed statically —
				// pass them through and let DuckDB catch errors at runtime.
				const columns = stage.columns.filter((column) =>
					column.expr.mode === 'sstring' || column.expr.mode === 'fstring'
						? true
						: deriveExprReferencesAvailableColumns(column.expr, availableSet)
				);
				if (columns.length === 0) break;
				nextStages.push({ ...stage, columns });
				availableColumns = [
					...availableColumns,
					...columns.map((column) => column.name).filter(Boolean)
				];
				break;
			}
			case 'group': {
				if (stage.window) {
					const allByAvailable = stage.by.every((column) => availableSet.has(column));
					const allSortKeysAvailable = stage.window.sortKeys.every((key) =>
						availableSet.has(key.column)
					);
					const derives = stage.window.derives.filter((column) =>
						deriveExprReferencesAvailableColumns(column.expr, availableSet)
					);
					if (
						!allByAvailable ||
						!allSortKeysAvailable ||
						derives.length !== stage.window.derives.length
					)
						break;
					nextStages.push({ ...stage, window: { ...stage.window, derives } });
					availableColumns = [...stage.by, ...derives.map((column) => column.name).filter(Boolean)];
					break;
				}

				if (stage.take !== undefined) {
					const by = stage.by.filter((column) => availableSet.has(column));
					if (by.length === 0) break;
					nextStages.push({ ...stage, by });
					availableColumns = [...by];
					break;
				}

				const by = stage.by.filter((column) => availableSet.has(column));
				const aggregations = stage.aggregations.filter((aggregation) => {
					if (aggregation.func === 'raw') return false;
					if (aggregation.func === 'count' && !aggregation.column) return true;
					return availableSet.has(aggregation.column);
				});
				if (stage.by.length > 0 && by.length === 0) break;
				if (by.length === 0 && aggregations.length === 0) break;
				nextStages.push({ ...stage, by, aggregations });
				availableColumns = [
					...by,
					...aggregations.map((aggregation) => aggregation.name).filter(Boolean)
				];
				break;
			}
			case 'sort': {
				let keys = stage.keys.filter((key) => availableSet.has(key.column));
				if (keys.length === 0 && stage.keys.length > 0) {
					const fallbackColumn = pickFallbackSortColumn(availableColumns, stage.keys[0].column);
					if (fallbackColumn) {
						keys = [{ ...stage.keys[0], column: fallbackColumn }];
					}
				}
				if (keys.length === 0) break;
				nextStages.push({ ...stage, keys });
				break;
			}
			case 'take':
			case 'append':
			case 'loop':
			case 'join':
			case 'from':
			case 'window':
				nextStages.push(stage);
				if (stage.type === 'window') {
					availableColumns = [
						...availableColumns,
						...stage.derives.map((column) => column.name).filter(Boolean)
					];
				}
				break;
		}
	}

	return nextStages;
}

/**
 * Split a PRQL string into its `let` binding blocks and the remaining main pipeline.
 * `let name = (\n  ...\n)` blocks are extracted in order; everything else is the main PRQL.
 * Does NOT strip inline comments — call this on the raw PRQL text.
 */
export function extractLetBindings(prql: string): {
	letBindings: { name: string; rawCode: string }[];
	mainPrql: string;
} {
	const lines = prql.split('\n');
	const letBindings: { name: string; rawCode: string }[] = [];
	const mainLines: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const trimmed = stripInlineComment(lines[i]).trim();

		// Skip standalone comment lines
		if (trimmed.startsWith('#')) {
			i++;
			continue;
		}

		const letMatch = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\($/.exec(trimmed);
		if (letMatch) {
			const name = letMatch[1];
			const innerLines: string[] = [];
			let depth = 1;
			i++;
			while (i < lines.length && depth > 0) {
				const next = stripInlineComment(lines[i]).trim();
				depth += (next.match(/\(/g) ?? []).length - (next.match(/\)/g) ?? []).length;
				if (depth > 0 && next) innerLines.push(next);
				i++;
			}
			letBindings.push({ name, rawCode: innerLines.join('\n') });
		} else {
			mainLines.push(lines[i]);
			i++;
		}
	}

	return { letBindings, mainPrql: mainLines.join('\n').trim() };
}

// ── Error-to-stage mapping ────────────────────────────────────────────────────

/** A PRQL compile error attributed to a specific pipeline stage. */
export interface PRQLStageError {
	reason: string;
	hint: string | null;
	/** Annotated display string from the compiler (includes source context). */
	display: string | null;
	/** 0-indexed line within this stage's generated PRQL block, or null if unknown. */
	stageLine: number | null;
}

/**
 * Maps raw PRQL compile errors to the GUI pipeline stage that caused them.
 *
 * @param stages - the GUI pipeline stages
 * @param errors - PRQL compile errors from `compilePRQL`
 * @param precedingLineCount - number of lines of code from preceding cells
 *   that prefix the compiled PRQL (so that error locations can be adjusted)
 */
export function mapErrorsToStages(
	stages: GUIPipelineStage[],
	errors: import('$lib/services/prql').PRQLError[],
	precedingLineCount: number
): Map<number, PRQLStageError[]> {
	const visibleStages: { guiIndex: number; stage: GUIPipelineStage }[] = stages
		.map((stage, guiIndex) => ({ guiIndex, stage }))
		.filter(({ stage }) => !stage.disabled);

	// Build cumulative line ranges for each stage in the generated PRQL.
	// guiToPreql joins stages with '\n', so each stage starts right after
	// the previous one's last line plus the '\n' separator.
	const stagePrqls = visibleStages.map(({ stage }) => stageToPreql(stage));
	const stageStartLines: number[] = [];
	let cursor = 0;
	for (const prql of stagePrqls) {
		stageStartLines.push(cursor);
		cursor += prql.split('\n').length;
		// guiToPreql uses .join('\n') — the '\n' between stages is NOT an extra
		// blank line, it is the line boundary itself. No additional offset.
	}

	const result = new Map<number, PRQLStageError[]>();
	if (visibleStages.length === 0) return result;

	for (const err of errors) {
		const row = err.location?.start[0] ?? null;
		if (row === null) {
			// No location info — fall back to stage 0 (from stage) since most
			// location-less errors are about the data source (table not found, etc.)
			const list = result.get(0) ?? [];
			list.push({
				reason: err.reason,
				hint: err.hint ?? null,
				display: err.display ?? null,
				stageLine: null
			});
			result.set(0, list);
			continue;
		}

		// Adjust for preceding cell lines
		const localRow = row - precedingLineCount;

		// Find the stage whose range contains localRow
		let visibleStageIdx = -1;
		for (let i = 0; i < stageStartLines.length; i++) {
			const start = stageStartLines[i];
			const end = i + 1 < stageStartLines.length ? stageStartLines[i + 1] - 1 : Infinity;
			if (localRow >= start && localRow <= end) {
				visibleStageIdx = i;
				break;
			}
		}

		if (visibleStageIdx === -1) continue; // outside the known range

		const stageLine = localRow - stageStartLines[visibleStageIdx];
		const guiStageIdx = visibleStages[visibleStageIdx].guiIndex;
		const list = result.get(guiStageIdx) ?? [];
		list.push({
			reason: err.reason,
			hint: err.hint ?? null,
			display: err.display ?? null,
			stageLine
		});
		result.set(guiStageIdx, list);
	}

	return result;
}

/**
 * For a derive stage, returns the set of chip (column) indices that have errors.
 * Uses the `stageLine` of each error to identify which derive column is affected.
 */
export function deriveChipErrors(
	stage: GUIPipelineStage,
	errors: PRQLStageError[]
): ReadonlySet<number> {
	if (stage.type !== 'derive') return new Set();

	const namedCols = stage.columns.filter((c) => c.name);
	const indices = new Set<number>();

	for (const err of errors) {
		if (err.stageLine === null) {
			// Unknown line — mark all chips
			namedCols.forEach((_, i) => indices.add(i));
			continue;
		}

		if (namedCols.length === 1) {
			// Single-column form: `derive col = expr` — always chip 0
			indices.add(0);
		} else {
			// Multi-column form:
			// line 0: `derive {`
			// line N (N >= 1): `  col[N-1] = ...`
			// last line: `}`
			const chipIdx = err.stageLine - 1;
			if (chipIdx >= 0 && chipIdx < namedCols.length) {
				indices.add(chipIdx);
			}
		}
	}

	return indices;
}
