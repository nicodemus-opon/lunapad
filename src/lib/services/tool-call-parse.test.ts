import { describe, it, expect, vi } from 'vitest';
import {
	parseToolCallObject,
	escapeControlCharsInStrings,
	parseMalformedCalltoolPayload,
	convertPythonDictSyntaxToJson
} from './tool-call-parse.js';

describe('parseToolCallObject', () => {
	it('parses well-formed tool calls unchanged', () => {
		const obj = parseToolCallObject(
			'{"tool":"create_cell","callId":"C1","args":{"outputName":"x","code":"SELECT 1"}}'
		);
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
		const obj = parseToolCallObject(
			'{"tool":"create_cell","args":{"code":"SELECT 1\\nFROM t","markdown":"## T\\n\\nBody"}}'
		);
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

	it('recovers a truncated JSON array by closing unbalanced brackets', () => {
		const raw =
			'[{"type": "text", "content": "Revenue Ops Review"}, {"type": "columns", "columns": [{"width": 2, "blocks": [{"type": "queryBlock", "cellId": "revenue_by_month"}, {"type": "queryBlock", "cellId": "region_performance"}]}, {"blocks": [{"type": "queryBlock", "cellId": "product_mix"}]}]}';
		const obj = parseToolCallObject(raw) as unknown as Record<string, unknown>[];
		expect(Array.isArray(obj)).toBe(true);
		expect(obj).toHaveLength(2);
		expect(obj[1].type).toBe('columns');
	});

	it('recovers a complete top-level value followed by trailing garbage', () => {
		const raw =
			'{"name": "apply_notebook_patch", "parameters": {"blueprint": {"executableCells": [{"cellId": "revenue_by_month", "code": "SELECT 1"}], "blocks": [{"type": "queryBlock", "cellId": "revenue_by_month"}]}}"}}';
		const obj = parseToolCallObject(raw);
		expect(obj?.name).toBe('apply_notebook_patch');
		const params = obj?.parameters as { blueprint: { executableCells: unknown[] } };
		expect(params.blueprint.executableCells).toHaveLength(1);
	});

	it('recovers malformed compact calltool syntax from local models', () => {
		const obj = parseMalformedCalltoolPayload('namelistcells{}');
		expect(obj).toEqual({ tool: 'list_cells', args: {} });
	});

	it('parseToolCallObject falls back to malformed compact calltool syntax', () => {
		const obj = parseToolCallObject('namelistcells{}');
		expect(obj).toEqual({ tool: 'list_cells', args: {} });
	});
});

describe('convertPythonDictSyntaxToJson', () => {
	it('converts single-quoted keys/values and Python literals to JSON', () => {
		const raw = "{'tool': 'x', 'args': {'a': True, 'b': False, 'c': None}}";
		expect(JSON.parse(convertPythonDictSyntaxToJson(raw))).toEqual({
			tool: 'x',
			args: { a: true, b: false, c: null }
		});
	});

	it('leaves already-valid double-quoted JSON unchanged in effect', () => {
		const raw = '{"tool":"x","args":{"a":1}}';
		expect(JSON.parse(convertPythonDictSyntaxToJson(raw))).toEqual({ tool: 'x', args: { a: 1 } });
	});

	it('preserves an apostrophe inside a double-quoted string', () => {
		const raw = '{"code": "don\'t stop"}';
		expect(JSON.parse(convertPythonDictSyntaxToJson(raw))).toEqual({ code: "don't stop" });
	});

	it('handles an escaped single quote inside a single-quoted string', () => {
		const raw = "{'code': 'don\\'t stop'}";
		expect(JSON.parse(convertPythonDictSyntaxToJson(raw))).toEqual({ code: "don't stop" });
	});

	// Regression: this exact payload shape (single-quoted apply_notebook_patch blueprint)
	// was observed live from a real model and silently dropped before this repair existed.
	it('recovers a real single-quoted apply_notebook_patch-style payload', () => {
		const raw =
			"{'title': 'new_model_2', 'blocks': [{'type': 'queryBlock', 'nodeId': 'tasks', 'cellId': 'tasks', 'outputName': 'tasks', 'cellType': 'query', 'language': 'sql', 'code': 'select 1 as a, 2 as b, 3 as c union all select 4,5,6'}]}";
		const parsed = JSON.parse(convertPythonDictSyntaxToJson(raw)) as {
			title: string;
			blocks: Array<{ code: string }>;
		};
		expect(parsed.title).toBe('new_model_2');
		expect(parsed.blocks[0].code).toBe('select 1 as a, 2 as b, 3 as c union all select 4,5,6');
	});
});

describe('parseToolCallObject with Python-dict-style payloads', () => {
	it('recovers a single-quoted tool call end-to-end', () => {
		const raw = "{'tool': 'apply_notebook_patch', 'args': {'title': 'Renamed', 'executableCells': []}}";
		const obj = parseToolCallObject(raw);
		expect(obj?.tool).toBe('apply_notebook_patch');
		expect((obj?.args as { title: string }).title).toBe('Renamed');
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
