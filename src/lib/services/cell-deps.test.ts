import { describe, it, expect } from 'vitest';
import {
	resolveDependencies,
	buildSQLExecutionCode,
	buildSQLGlobalExecutionCode
} from './cell-deps.js';
import type { Cell } from '$lib/stores/notebook.svelte';

function queryCell(outputName: string, code: string, language: 'prql' | 'sql' = 'sql'): Cell {
	return { id: outputName, cellType: 'query', outputName, code, language } as unknown as Cell;
}

function udfCell(udfBody: string, outputName: string): Cell {
	return { id: outputName, cellType: 'udf', outputName, code: '', udfBody } as unknown as Cell;
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

describe('buildSQLGlobalExecutionCode with UDF deps', () => {
	it('resolves a cross-notebook UDF reference via the global registry', () => {
		const udf = udfCell(DOUBLE_UDF, 'double_it');
		const cells = [queryCell('result', 'SELECT double_it(1)')];
		const globalRegistry = new Map([['double_it', udf]]);
		const sql = buildSQLGlobalExecutionCode(cells, 0, globalRegistry, () => null);
		expect(sql).toBe(`WITH ${DOUBLE_FRAGMENT}\nSELECT double_it(1)`);
	});
});
