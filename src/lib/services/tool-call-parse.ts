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
	const squashed = name.toLowerCase().replace(/[^a-z_]/g, '').replace(/^name/, '');
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
		console.error(
			'[ai/chat] dropped unparseable tool call:',
			err instanceof Error ? err.message : err,
			'\nPayload:',
			raw.slice(0, 500)
		);
		return null;
	}
}
