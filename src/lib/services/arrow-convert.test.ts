import { describe, expect, it } from 'vitest';
import { arrowValueToJS } from './arrow-convert';

// Minimal stand-in for Arrow StructRow / Vector wrappers
function fakeArrowWrapper(json: unknown) {
	return {
		toJSON: () => json,
		get: () => undefined
	};
}

describe('arrowValueToJS', () => {
	it('passes primitives and null through', () => {
		expect(arrowValueToJS(null)).toBeNull();
		expect(arrowValueToJS(undefined)).toBeUndefined();
		expect(arrowValueToJS(42)).toBe(42);
		expect(arrowValueToJS('text')).toBe('text');
		expect(arrowValueToJS(true)).toBe(true);
	});

	it('converts safe bigints to numbers', () => {
		expect(arrowValueToJS(123n)).toBe(123);
		expect(arrowValueToJS(-9007199254740991n)).toBe(-9007199254740991);
	});

	it('converts unsafe bigints to strings', () => {
		expect(arrowValueToJS(9223372036854775807n)).toBe('9223372036854775807');
	});

	it('passes Date through unchanged (not via toJSON)', () => {
		const d = new Date('2026-01-01T00:00:00Z');
		expect(arrowValueToJS(d)).toBe(d);
	});

	it('converts BigInt64Array to plain number/string arrays', () => {
		const out = arrowValueToJS(new BigInt64Array([1n, 9223372036854775807n]));
		expect(out).toEqual([1, '9223372036854775807']);
	});

	it('passes non-bigint typed arrays through for hugeint limb decoding', () => {
		const limbs = new Uint32Array([5300, 0, 0, 0]);
		expect(arrowValueToJS(limbs)).toBe(limbs);
	});

	it('unwraps Arrow wrappers via toJSON, recursively', () => {
		const struct = fakeArrowWrapper({ a: 1n, b: fakeArrowWrapper([2n, 'x']) });
		expect(arrowValueToJS(struct)).toEqual({ a: 1, b: [2, 'x'] });
	});

	it('recurses through arrays and plain objects', () => {
		expect(arrowValueToJS([{ n: 7n }, [8n]])).toEqual([{ n: 7 }, [8]]);
	});

	it('produces JSON.stringify-safe output for nested structures', () => {
		const value = arrowValueToJS(
			fakeArrowWrapper({
				big: 9223372036854775807n,
				list: [1n, 2n],
				nested: { deep: fakeArrowWrapper({ x: 3n }) }
			})
		);
		expect(() => JSON.stringify(value)).not.toThrow();
		expect(JSON.parse(JSON.stringify(value))).toEqual({
			big: '9223372036854775807',
			list: [1, 2],
			nested: { deep: { x: 3 } }
		});
	});
});
