import { describe, it, expect } from 'vitest';
import {
	resolveDependencies,
	resolveGlobalDependencies,
	buildSQLExecutionCode,
	buildSQLGlobalExecutionCode,
	CircularCellDependencyError
} from './cell-deps.js';
import type { Cell } from '$lib/stores/notebook.svelte';
import { defaultControlCellConfig } from './control-cells.js';

function queryCell(outputName: string, code: string, language: 'prql' | 'sql' = 'sql'): Cell {
	return { id: outputName, cellType: 'query', outputName, code, language } as unknown as Cell;
}

function udfCell(udfBody: string, outputName: string): Cell {
	return { id: outputName, cellType: 'udf', outputName, code: '', udfBody } as unknown as Cell;
}

function tableInputCell(outputName: string): Cell {
	const rows = [
		{ key: 'current', value: 12 },
		{ key: 'comparison', value: 8 }
	];
	return {
		id: outputName,
		cellType: 'table-input',
		outputName,
		code: '',
		language: 'sql',
		controlConfig: {
			...defaultControlCellConfig('table-input', outputName),
			tableData: { columns: ['key', 'value'], rows }
		},
		result: { columns: ['key', 'value'], rows }
	} as unknown as Cell;
}

const DOUBLE_UDF = 'def double_it(x: int) -> int:\n    return x * 2\n';
const DOUBLE_FRAGMENT =
	`FUNCTION double_it(x bigint)\n` +
	`RETURNS bigint\n` +
	`LANGUAGE PYTHON\n` +
	`WITH (handler = 'double_it')\n` +
	`AS $$\n${DOUBLE_UDF.trim()}\n$$`;

describe('resolveDependencies with UDF cells', () => {
	it('includes a udf cell referenced by whole-word match', () => {
		const cells = [udfCell(DOUBLE_UDF, 'double_it'), queryCell('result', 'SELECT double_it(1)')];
		const deps = resolveDependencies(cells, 1);
		expect(deps).toEqual([cells[0]]);
	});

	it('does not include a udf cell whose name only partially matches', () => {
		const cells = [udfCell(DOUBLE_UDF, 'double_it'), queryCell('result', 'SELECT double_it_v2(1)')];
		const deps = resolveDependencies(cells, 1);
		expect(deps).toEqual([]);
	});
});

describe('buildSQLExecutionCode with UDF deps', () => {
	it('splices the FUNCTION fragment into the WITH clause alongside CTE deps', () => {
		const cells = [
			udfCell(DOUBLE_UDF, 'double_it'),
			queryCell('orders', 'SELECT 1 AS id'),
			queryCell('result', 'SELECT double_it(id) FROM orders')
		];
		const sql = buildSQLExecutionCode(cells, 2, () => null);
		expect(sql).toBe(
			`WITH ${DOUBLE_FRAGMENT},\n` +
				`orders AS (\n  SELECT 1 AS id\n)\n` +
				`SELECT double_it(id) FROM orders`
		);
	});

	it("merges with the cell's own leading WITH clause", () => {
		const cells = [
			udfCell(DOUBLE_UDF, 'double_it'),
			queryCell('result', 'WITH x AS (SELECT 1) SELECT double_it(*) FROM x')
		];
		const sql = buildSQLExecutionCode(cells, 1, () => null);
		expect(sql).toBe(`WITH ${DOUBLE_FRAGMENT},\nx AS (\n  SELECT 1\n)\nSELECT double_it(*) FROM x`);
	});

	it('returns the cell code unchanged when the UDF body fails to parse', () => {
		const cells = [
			udfCell('def double_it(x) -> int:\n    return x\n', 'double_it'),
			queryCell('result', 'SELECT double_it(1)')
		];
		const sql = buildSQLExecutionCode(cells, 1, () => null);
		expect(sql).toBe('SELECT double_it(1)');
	});
});

describe('buildSQLExecutionCode with control deps', () => {
	it('turns a table input result into a SQL CTE', () => {
		const cells = [
			tableInputCell('thresholds'),
			queryCell('result', "SELECT key, value FROM thresholds WHERE key = 'current'")
		];
		const sql = buildSQLExecutionCode(cells, 1, () => null);
		expect(sql).toBe(
			`WITH thresholds AS (\n` +
				`  SELECT * FROM (VALUES ('current', 12), ('comparison', 8)) AS "thresholds" ("key", "value")\n` +
				`)\n` +
				`SELECT key, value FROM thresholds WHERE key = 'current'`
		);
	});
});

describe('circular cell dependencies', () => {
	it('throws a clear error for a same-notebook cycle instead of silently truncating it', () => {
		const cells = [
			queryCell('a', 'SELECT * FROM b'),
			queryCell('b', 'SELECT * FROM a'),
			queryCell('result', 'SELECT * FROM a')
		];
		expect(() => resolveDependencies(cells, 2)).toThrow(CircularCellDependencyError);
	});

	it('throws a clear error for a cross-notebook cycle via the global registry', () => {
		const a = queryCell('a', 'SELECT * FROM b');
		const b = queryCell('b', 'SELECT * FROM a');
		const cells = [queryCell('result', 'SELECT * FROM a')];
		const globalRegistry = new Map([
			['a', a],
			['b', b]
		]);
		expect(() => resolveGlobalDependencies(cells, 0, globalRegistry)).toThrow(
			CircularCellDependencyError
		);
	});
});

describe('buildSQLGlobalExecutionCode with UDF deps', () => {
	it('resolves a cross-notebook UDF reference via the global registry', () => {
		const udf = udfCell(DOUBLE_UDF, 'double_it');
		const cells = [queryCell('result', 'SELECT double_it(1)')];
		const globalRegistry = new Map([['double_it', udf]]);
		const sql = buildSQLGlobalExecutionCode(cells, 0, globalRegistry, () => null);
		expect(sql).toBe(`WITH ${DOUBLE_FRAGMENT}\nSELECT double_it(1)`);
	});

	it('resolves a cross-notebook control reference via the global registry', () => {
		const cells = [queryCell('result', 'SELECT * FROM thresholds')];
		const globalRegistry = new Map([['thresholds', tableInputCell('thresholds')]]);
		const sql = buildSQLGlobalExecutionCode(cells, 0, globalRegistry, () => null);
		expect(sql).toBe(
			`WITH thresholds AS (\n` +
				`  SELECT * FROM (VALUES ('current', 12), ('comparison', 8)) AS "thresholds" ("key", "value")\n` +
				`)\n` +
				`SELECT * FROM thresholds`
		);
	});
});
