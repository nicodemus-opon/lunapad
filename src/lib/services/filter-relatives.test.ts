import { describe, expect, it, vi, afterEach } from 'vitest';
import { relativeDateRange, formatRelativeDateFilterValue } from './filter-relatives';

describe('filter-relatives', () => {
	const now = new Date('2026-07-01T12:00:00Z');

	afterEach(() => {
		vi.useRealTimers();
	});

	it('computes last 7 days', () => {
		const { start, end } = relativeDateRange('last7', now);
		expect(end).toBe('2026-07-01');
		expect(start).toBe('2026-06-25');
	});

	it('formats start/end params', () => {
		// `formatRelativeDateFilterValue` reads the system clock internally, so pin it.
		vi.useFakeTimers();
		vi.setSystemTime(now);
		expect(formatRelativeDateFilterValue('last30', 'start', 'end')).toEqual({
			start: '2026-06-02',
			end: '2026-07-01'
		});
	});
});
