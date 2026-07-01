import { describe, expect, it } from 'vitest';
import { sanitizeCompletion } from './sanitize';

describe('sanitizeCompletion', () => {
	it('strips fenced code blocks', () => {
		expect(sanitizeCompletion('```prql\nstatus == "active"\n```', 'filter ')).toBe(
			'status == "active"'
		);
	});

	it('strips thinking tags', () => {
		const openThink = '<' + 'think>';
		const closeThink = '</' + 'think>';
		expect(sanitizeCompletion(`${openThink}hmm${closeThink}status == "active"`, 'filter ')).toBe(
			'status == "active"'
		);
		expect(sanitizeCompletion('<think>hmm</think>status == "active"', 'filter ')).toBe(
			'status == "active"'
		);
	});

	it('drops a leading preamble line', () => {
		expect(sanitizeCompletion("Here's the completion:\nstatus == 'active'", 'where ')).toBe(
			"status == 'active'"
		);
	});

	it('removes prefix overlap', () => {
		expect(sanitizeCompletion('status == "active"', 'filter status == ')).toBe('"active"');
	});

	it('removes suffix overlap', () => {
		expect(sanitizeCompletion('status == "active"\nselect id', 'filter ', '\nselect id')).toBe(
			'status == "active"'
		);
	});

	it('caps to 8 lines and 500 chars', () => {
		const long = Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n');
		expect(sanitizeCompletion(long, '').split('\n')).toHaveLength(8);
		expect(sanitizeCompletion('x'.repeat(600), '').length).toBeLessThanOrEqual(500);
	});

	it('returns empty for whitespace-only output', () => {
		expect(sanitizeCompletion('   \n  ', 'prefix')).toBe('');
	});

	it('strips leading ellipsis', () => {
		expect(sanitizeCompletion('...revenue DESC', 'ORDER BY ')).toBe('revenue DESC');
	});

	it('salvages new tokens after a prefix echo', () => {
		const prefix =
			'SELECT region, SUM(quantity * unit_price) AS revenue FROM orders GROUP BY region ORDER BY ';
		const echoed =
			'SUM(quantity * unit_price) AS revenue FROM orders GROUP BY region ORDER BY revenue DESC';
		expect(sanitizeCompletion(echoed, prefix)).toBe('revenue DESC');
	});

	it('discards completions that mostly repeat the prefix', () => {
		const prefix =
			'SELECT region, SUM(quantity * unit_price) AS total_revenue\nFROM orders\nGROUP BY region\nHAVING ';
		const echoed =
			'SUM(quantity * unit_price) AS total_revenue\nFROM orders\nGROUP BY region\nHAVING';
		expect(sanitizeCompletion(echoed, prefix)).toBe('');
	});
});
