import { describe, expect, it } from 'vitest';
import { relativeDateRange, formatRelativeDateFilterValue } from './filter-relatives';

describe('filter-relatives', () => {
	const now = new Date('2026-07-01T12:00:00Z');

	it('computes last 7 days', () => {
		const { start, end } = relativeDateRange('last7', now);
		expect(end).toBe('2026-07-01');
		expect(start).toBe('2026-06-25');
	});

	it('formats start/end params', () => {
		expect(formatRelativeDateFilterValue('last30', 'start', 'end')).toEqual({
			start: '2026-06-02',
			end: '2026-07-01'
		});
	});
});
