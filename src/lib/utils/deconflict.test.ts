import { describe, expect, it } from 'vitest';
import { deconflictName } from './deconflict.js';

describe('deconflictName', () => {
	it('returns the base name unchanged when not taken', () => {
		expect(deconflictName(new Set(['a', 'b']), 'c')).toBe('c');
	});

	it('appends _copy when the base name is taken', () => {
		expect(deconflictName(new Set(['c']), 'c')).toBe('c_copy');
	});

	it('increments the suffix until a free name is found', () => {
		expect(deconflictName(new Set(['c', 'c_copy', 'c_copy2']), 'c')).toBe('c_copy3');
	});

	it('accepts a plain array as well as a Set', () => {
		expect(deconflictName(['c'], 'c')).toBe('c_copy');
	});

	it('passes through an empty base name', () => {
		expect(deconflictName(new Set(['']), '')).toBe('');
	});
});
