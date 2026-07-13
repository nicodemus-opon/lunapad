/**
 * Lenient JSON parsing for LLM tool-call payloads.
 *
 * Models that emit tool calls as `<tool_call>{...}</tool_call>` (or bare JSON) routinely
 * produce invalid JSON: multi-line SQL is written with literal newlines/tabs inside string
 * values like `"code":"SELECT ...\n FROM ..."`. Strict `JSON.parse` rejects these with
 * "Bad control character in string literal", and without repair the tool call is silently
 * dropped — the AI appears to "do nothing" and the SQL-fix loop spins until it gives up.
 */

/**
 * Re-escape raw (unescaped) control characters that appear *inside* JSON string literals.
 * Walks the text tracking string/escape state so control characters outside strings (the
 * insignificant whitespace JSON allows) are left untouched, and already-escaped sequences
 * (`\n`, `\"`) are preserved verbatim.
 */
export function escapeControlCharsInStrings(raw: string): string {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			out += ch;
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			out += ch;
			continue;
		}
		if (inString) {
			if (ch === '\n') {
				out += '\\n';
				continue;
			}
			if (ch === '\r') {
				out += '\\r';
				continue;
			}
			if (ch === '\t') {
				out += '\\t';
				continue;
			}
			const code = ch.charCodeAt(0);
			if (code < 0x20) {
				out += '\\u' + code.toString(16).padStart(4, '0');
				continue;
			}
		}
		out += ch;
	}
	return out;
}

/**
 * Drop the backslash from illegal `\'` escapes inside JSON string literals. JSON only allows
 * escaping `"`, `\`, `/`, and a handful of control-char shorthands — `\'` is not among them, so
 * `JSON.parse` rejects it with "Bad escaped character in JSON". Models routinely produce this:
 * SQL/PRQL code bodies are full of single-quoted string literals (`WHERE name = 'C2'`), and a
 * model reflexively escapes the apostrophe the way it would in Python/JS source, not realizing
 * JSON string literals don't need it. Found live against a real model, whose tool call was
 * silently dropped by parseToolCallObject with no other repair path (convertPythonDictSyntaxToJson
 * only rewrites top-level single-quoted Python-dict syntax; it copies already-double-quoted
 * string contents — including a stray `\'` inside them — through verbatim).
 */
export function unescapeIllegalSingleQuotes(raw: string): string {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			if (ch === "'") {
				out += "'";
			} else {
				out += '\\' + ch;
			}
			escaped = false;
			continue;
		}
		if (inString && ch === '\\') {
			escaped = true;
			continue;
		}
		if (ch === '"') inString = !inString;
		out += ch;
	}
	return out;
}

/**
 * For a (possibly truncated) JSON prefix, compute the characters needed to close any open
 * string and any open brackets/braces, in the correct (reverse) order. Returns null if the
 * prefix has no unclosed structure (either it's already balanced, or contains none).
 */
function computeClosingSuffix(prefix: string): string | null {
	const stack: Array<'{' | '['> = [];
	let inString = false;
	let escaped = false;
	let sawOpen = false;

	for (let i = 0; i < prefix.length; i++) {
		const ch = prefix[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === '{' || ch === '[') {
			stack.push(ch);
			sawOpen = true;
			continue;
		}
		if (ch === '}' || ch === ']') {
			stack.pop();
		}
	}

	if (!sawOpen || (stack.length === 0 && !inString)) return null;
	let closing = '';
	if (inString) closing += '"';
	for (let i = stack.length - 1; i >= 0; i--) {
		closing += stack[i] === '{' ? '}' : ']';
	}
	return closing;
}

/**
 * Repair a JSON value that is either truncated mid-structure (model stopped emitting before
 * closing all open brackets/braces/strings) or has trailing garbage after an otherwise-complete
 * top-level value (model appended a stray closing quote/brace it thought it owed). Tries the
 * full string first, then progressively shorter prefixes cut at `}`/`]` boundaries, closing any
 * remaining open structure at each length — returns the first variant that parses.
 */
function repairMalformedJson(raw: string): Record<string, unknown> | null {
	const candidateEnds = [raw.length];
	let attempts = 0;
	for (let i = raw.length - 1; i >= 0 && attempts < 80; i--) {
		if (raw[i] !== '}' && raw[i] !== ']') continue;
		attempts++;
		candidateEnds.push(i + 1);
	}

	for (const end of candidateEnds) {
		const prefix = raw.slice(0, end);
		try {
			return JSON.parse(prefix) as Record<string, unknown>;
		} catch {
			/* try closing open structure, then an earlier cut point */
		}
		const suffix = computeClosingSuffix(prefix);
		if (suffix) {
			try {
				return JSON.parse(prefix + suffix) as Record<string, unknown>;
			} catch {
				/* try an earlier cut point */
			}
		}
	}
	return null;
}

/**
 * Convert Python-dict-style syntax (`{'tool': 'x', 'args': {'a': True, 'b': None}}`) into
 * valid JSON. Some models — especially under load or with weaker instruction-following —
 * emit tool-call payloads using Python literal syntax instead of JSON: single-quoted
 * strings and `True`/`False`/`None` instead of `true`/`false`/`null`. Without this repair
 * the payload fails JSON.parse and is silently dropped (see parseToolCallObject), so the
 * requested mutation just never happens while the model still reports success.
 *
 * Single-pass character scan tracking string state so double-quoted string contents are
 * copied verbatim, single-quoted strings are re-emitted as double-quoted JSON strings
 * (embedded `"` escaped, `\'` unescaped to a literal `'`), and Python literal keywords are
 * only substituted when they appear outside any string.
 */
export function convertPythonDictSyntaxToJson(raw: string): string {
	let out = '';
	let i = 0;
	const n = raw.length;
	while (i < n) {
		const ch = raw[i];
		if (ch === '"') {
			out += ch;
			i++;
			while (i < n) {
				out += raw[i];
				if (raw[i] === '\\' && i + 1 < n) {
					i++;
					out += raw[i];
					i++;
					continue;
				}
				if (raw[i] === '"') {
					i++;
					break;
				}
				i++;
			}
			continue;
		}
		if (ch === "'") {
			out += '"';
			i++;
			while (i < n) {
				const c = raw[i];
				if (c === '\\' && i + 1 < n) {
					const next = raw[i + 1];
					if (next === "'") {
						out += "'";
						i += 2;
						continue;
					}
					out += c;
					out += next;
					i += 2;
					continue;
				}
				if (c === "'") {
					i++;
					break;
				}
				if (c === '"') {
					out += '\\"';
					i++;
					continue;
				}
				out += c;
				i++;
			}
			out += '"';
			continue;
		}
		if (/[A-Za-z_]/.test(ch)) {
			let j = i;
			while (j < n && /[A-Za-z_]/.test(raw[j])) j++;
			const word = raw.slice(i, j);
			if (word === 'True') out += 'true';
			else if (word === 'False') out += 'false';
			else if (word === 'None') out += 'null';
			else out += word;
			i = j;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

const MALFORMED_CALLTOOL_NAME_MAP: Record<string, string> = {
	listcells: 'list_cells',
	getcellresult: 'get_cell_result',
	getlineage: 'get_lineage',
	searchworkspace: 'search_workspace',
	querydata: 'query_data',
	sampledata: 'sample_data',
	profilecolumn: 'profile_column',
	recorddecision: 'record_decision',
	createcell: 'create_cell',
	updatecell: 'update_cell',
	deletecell: 'delete_cell',
	movecell: 'move_cell',
	runcells: 'run_cells',
	pickchart: 'pick_chart',
	setchart: 'set_chart'
};

function normalizeMalformedCalltoolName(name: string): string | null {
	const squashed = name
		.toLowerCase()
		.replace(/[^a-z_]/g, '')
		.replace(/^name/, '');
	if (!squashed) return null;
	if (MALFORMED_CALLTOOL_NAME_MAP[squashed]) return MALFORMED_CALLTOOL_NAME_MAP[squashed];
	if (squashed.includes('_')) return squashed;
	return squashed.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Small local models sometimes emit malformed tool markup like
 * `<calltool namelistcells{}</calltool>` instead of `<tool_call>{"tool":"list_cells","args":{}}</tool_call>`.
 * Recover those into the normal parsed object shape so the agent loop can continue. */
export function parseMalformedCalltoolPayload(raw: string): Record<string, unknown> | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const jsonStart = trimmed.indexOf('{');
	const head = (jsonStart === -1 ? trimmed : trimmed.slice(0, jsonStart)).trim();
	const argsRaw = jsonStart === -1 ? '{}' : trimmed.slice(jsonStart).trim();
	const tool = normalizeMalformedCalltoolName(head);
	if (!tool) return null;

	try {
		return {
			tool,
			args: JSON.parse(escapeControlCharsInStrings(argsRaw)) as Record<string, unknown>
		};
	} catch {
		return null;
	}
}

/**
 * Parse a JSON tool-call object, tolerating raw control characters inside string values.
 * Returns the parsed object, or null if it still cannot be parsed after repair. Logs the
 * failing payload so silently-dropped tool calls become diagnosable instead of invisible.
 */
export function parseToolCallObject(raw: string): Record<string, unknown> | null {
	if (!raw.trim()) return null;
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		/* fall through to control-char repair */
	}
	try {
		return JSON.parse(escapeControlCharsInStrings(raw)) as Record<string, unknown>;
	} catch (err) {
		const repaired = parseMalformedCalltoolPayload(raw);
		if (repaired) return repaired;
		const salvaged = repairMalformedJson(escapeControlCharsInStrings(raw));
		if (salvaged) return salvaged;
		// Illegal `\'` escapes (a model over-escaping apostrophes inside SQL/PRQL code strings)
		// are common enough on their own — not part of Python-dict syntax — to fix as a
		// dedicated step, composed with the same control-char repair above.
		try {
			return JSON.parse(escapeControlCharsInStrings(unescapeIllegalSingleQuotes(raw))) as Record<
				string,
				unknown
			>;
		} catch {
			const quoteSalvaged = repairMalformedJson(
				escapeControlCharsInStrings(unescapeIllegalSingleQuotes(raw))
			);
			if (quoteSalvaged) return quoteSalvaged;
		}
		const pythonConverted = convertPythonDictSyntaxToJson(raw);
		if (pythonConverted !== raw) {
			try {
				return JSON.parse(escapeControlCharsInStrings(pythonConverted)) as Record<string, unknown>;
			} catch {
				const pythonSalvaged = repairMalformedJson(escapeControlCharsInStrings(pythonConverted));
				if (pythonSalvaged) return pythonSalvaged;
			}
		}
		console.error(
			'[ai/chat] dropped unparseable tool call:',
			err instanceof Error ? err.message : err,
			'\nPayload:',
			process.env.DEBUG_TOOL_CALL_PARSE ? raw : raw.slice(0, 500)
		);
		return null;
	}
}
