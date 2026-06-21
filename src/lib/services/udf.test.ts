import { describe, it, expect } from 'vitest';
import { parseUdfSignature, compileUdfFragment } from './udf.js';
import type { Cell } from '$lib/stores/notebook.svelte';

function udfCell(udfBody: string): Cell {
	return { cellType: 'udf', udfBody, outputName: '' } as unknown as Cell;
}

describe('parseUdfSignature', () => {
	it('parses a single-arg function', () => {
		const sig = parseUdfSignature('def my_udf(x: int) -> float:\n    return x * 1.5\n');
		expect(sig).toEqual({
			name: 'my_udf',
			params: [{ name: 'x', type: 'bigint' }],
			returnType: 'double'
		});
	});

	it('parses a multi-arg function with mixed types', () => {
		const sig = parseUdfSignature('def combine(a: str, b: bool) -> str:\n    return a\n');
		expect(sig).toEqual({
			name: 'combine',
			params: [
				{ name: 'a', type: 'varchar' },
				{ name: 'b', type: 'boolean' }
			],
			returnType: 'varchar'
		});
	});

	it('parses a no-arg function', () => {
		const sig = parseUdfSignature('def today() -> datetime.date:\n    return None\n');
		expect(sig).toEqual({ name: 'today', params: [], returnType: 'date' });
	});

	it('maps datetime.datetime to timestamp', () => {
		const sig = parseUdfSignature('def now() -> datetime.datetime:\n    return None\n');
		expect(sig).toEqual({ name: 'now', params: [], returnType: 'timestamp' });
	});

	it('rejects a missing type hint on a parameter', () => {
		const sig = parseUdfSignature('def f(x) -> int:\n    return x\n');
		expect(sig).toHaveProperty('error');
	});

	it('rejects a missing return type hint', () => {
		const sig = parseUdfSignature('def f(x: int):\n    return x\n');
		expect(sig).toHaveProperty('error');
	});

	it('rejects *args', () => {
		const sig = parseUdfSignature('def f(*args) -> int:\n    return 1\n');
		expect(sig).toHaveProperty('error');
	});

	it('rejects **kwargs', () => {
		const sig = parseUdfSignature('def f(**kwargs) -> int:\n    return 1\n');
		expect(sig).toHaveProperty('error');
	});

	it('rejects a default value', () => {
		const sig = parseUdfSignature('def f(x: int = 1) -> int:\n    return x\n');
		expect(sig).toHaveProperty('error');
	});

	it('rejects an unmapped annotation', () => {
		const sig = parseUdfSignature('def f(x: list) -> int:\n    return 1\n');
		expect(sig).toHaveProperty('error');
	});

	it('rejects more than one top-level def', () => {
		const sig = parseUdfSignature(
			'def f(x: int) -> int:\n    return x\n\ndef g(y: int) -> int:\n    return y\n'
		);
		expect(sig).toHaveProperty('error');
	});

	it('rejects no function definition', () => {
		const sig = parseUdfSignature('x = 1\n');
		expect(sig).toHaveProperty('error');
	});
});

describe('compileUdfFragment', () => {
	it('compiles a valid signature into a Trino FUNCTION fragment', () => {
		const fragment = compileUdfFragment(
			udfCell('def my_udf(x: int) -> float:\n    return x * 1.5\n')
		);
		expect(fragment).toBe(
			`FUNCTION my_udf(x bigint)\n` +
				`RETURNS double\n` +
				`LANGUAGE PYTHON\n` +
				`WITH (handler = 'my_udf')\n` +
				`AS $$\ndef my_udf(x: int) -> float:\n    return x * 1.5\n$$`
		);
	});

	it('surfaces a parse error instead of a fragment', () => {
		const fragment = compileUdfFragment(udfCell('def f(x) -> int:\n    return x\n'));
		expect(fragment).toHaveProperty('error');
	});
});
