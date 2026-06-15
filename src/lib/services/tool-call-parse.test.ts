import { describe, it, expect, vi } from 'vitest';
import { parseToolCallObject, escapeControlCharsInStrings } from './tool-call-parse.js';

describe('parseToolCallObject', () => {
	it('parses well-formed tool calls unchanged', () => {
		const obj = parseToolCallObject('{"tool":"create_cell","callId":"C1","args":{"outputName":"x","code":"SELECT 1"}}');
		expect(obj?.tool).toBe('create_cell');
		expect((obj?.args as { code: string }).code).toBe('SELECT 1');
	});

	// The core regression: models emit multi-line SQL with LITERAL newlines/tabs inside
	// string values, which strict JSON.parse rejects ("Bad control character"). Before the
	// lenient parser these tool calls were silently dropped, so the AI SQL-fix loop appeared
	// to do nothing and eventually gave up with "Couldn't fix all SQL errors".
	it('recovers tool calls with raw newlines and tabs inside SQL', () => {
		const raw =
			'{"tool":"update_cell","callId":"U1","args":{"cellId":"sales","code":"SELECT month,\n\tSUM(revenue) AS revenue\nFROM orders\nGROUP BY 1"}}';
		expect(() => JSON.parse(raw)).toThrow(); // strict parse fails — the original bug
		const obj = parseToolCallObject(raw);
		expect(obj?.tool).toBe('update_cell');
		expect((obj?.args as { code: string }).code).toBe(
			'SELECT month,\n\tSUM(revenue) AS revenue\nFROM orders\nGROUP BY 1'
		);
	});

	it('does not double-escape already-escaped sequences', () => {
		const obj = parseToolCallObject('{"tool":"create_cell","args":{"code":"SELECT 1\\nFROM t","markdown":"## T\\n\\nBody"}}');
		expect((obj?.args as { code: string }).code).toBe('SELECT 1\nFROM t');
		expect((obj?.args as { markdown: string }).markdown).toBe('## T\n\nBody');
	});

	it('tracks escaped quotes when a raw newline appears later in the string', () => {
		const raw = '{"tool":"query_data","args":{"sql":"SELECT \\"col a\\",\nb FROM t"}}';
		const obj = parseToolCallObject(raw);
		expect(obj?.tool).toBe('query_data');
		expect((obj?.args as { sql: string }).sql).toBe('SELECT "col a",\nb FROM t');
	});

	it('returns null (without throwing) for unrecoverable payloads', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(parseToolCallObject('{not json at all')).toBeNull();
		spy.mockRestore();
	});
});

describe('escapeControlCharsInStrings', () => {
	it('leaves control characters outside strings untouched', () => {
		// Newlines between JSON tokens are insignificant whitespace and must survive verbatim.
		const input = '{\n  "tool": "x",\n  "args": {}\n}';
		expect(escapeControlCharsInStrings(input)).toBe(input);
		expect(JSON.parse(escapeControlCharsInStrings(input)).tool).toBe('x');
	});
});
