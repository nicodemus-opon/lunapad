import { describe, expect, it } from 'vitest';
import { estimateTokens, fitToTokenBudget } from './token-budget';

describe('estimateTokens', () => {
	it('returns 0 for empty input', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('returns a positive count proportional to text length', () => {
		const short = estimateTokens('hello world');
		const long = estimateTokens('hello world '.repeat(50));
		expect(short).toBeGreaterThan(0);
		expect(long).toBeGreaterThan(short * 10);
	});
});

describe('fitToTokenBudget', () => {
	it('keeps items in order until the budget is exceeded', () => {
		const items = ['a', 'bb', 'ccc', 'dddd'];
		const { kept, dropped } = fitToTokenBudget(items, 5, (s) => s.length);
		expect(kept).toEqual(['a', 'bb']);
		expect(dropped).toEqual(['ccc', 'dddd']);
	});

	it('keeps everything when well under budget', () => {
		const items = ['a', 'b', 'c'];
		const { kept, dropped } = fitToTokenBudget(items, 100, (s) => s.length);
		expect(kept).toEqual(items);
		expect(dropped).toEqual([]);
	});

	it('drops everything when even the first item exceeds the budget', () => {
		const items = ['toolong'];
		const { kept, dropped } = fitToTokenBudget(items, 1, (s) => s.length);
		expect(kept).toEqual([]);
		expect(dropped).toEqual(['toolong']);
	});

	it('does not reorder — caller is responsible for pre-sorting by relevance', () => {
		const items = [3, 1, 2];
		const { kept } = fitToTokenBudget(items, 100, () => 1);
		expect(kept).toEqual([3, 1, 2]);
	});
});
