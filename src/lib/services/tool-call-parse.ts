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
		if (escaped) { out += ch; escaped = false; continue; }
		if (ch === '\\') { out += ch; escaped = true; continue; }
		if (ch === '"') { inString = !inString; out += ch; continue; }
		if (inString) {
			if (ch === '\n') { out += '\\n'; continue; }
			if (ch === '\r') { out += '\\r'; continue; }
			if (ch === '\t') { out += '\\t'; continue; }
			const code = ch.charCodeAt(0);
			if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
		}
		out += ch;
	}
	return out;
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
	} catch { /* fall through to control-char repair */ }
	try {
		return JSON.parse(escapeControlCharsInStrings(raw)) as Record<string, unknown>;
	} catch (err) {
		console.error('[ai/chat] dropped unparseable tool call:', err instanceof Error ? err.message : err, '\nPayload:', raw.slice(0, 500));
		return null;
	}
}
