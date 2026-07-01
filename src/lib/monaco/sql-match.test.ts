import { describe, expect, it } from 'vitest';
import { prefixMatches, scoreMatch } from './sql-match';

describe('scoreMatch', () => {
	it('matches exact prefix', () => {
		expect(scoreMatch('orders', 'ord').kind).toBe('prefix');
	});

	it('matches camelCase initials', () => {
		expect(prefixMatches('customer_id', 'ci')).toBe(true);
		expect(scoreMatch('customer_id', 'ci').kind).toBe('initials');
	});

	it('matches underscore token prefix', () => {
		expect(prefixMatches('order_amount', 'ord_am')).toBe(true);
	});

	it('rejects unrelated strings', () => {
		expect(prefixMatches('customers', 'xyz')).toBe(false);
	});
});
