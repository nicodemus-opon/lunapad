import { describe, it, expect } from 'vitest';
import { interpolateMarkdownRefs, extractMarkdownRefs } from './markdown-interp.js';
import type { Cell } from '$lib/stores/notebook.svelte';

function makeCell(outputName: string, rows: Record<string, unknown>[], columns?: string[]): Cell {
	return {
		id: outputName,
		outputName,
		cellType: 'query',
		result: { rows, columns: columns ?? Object.keys(rows[0] ?? {}), truncated: false }
	} as unknown as Cell;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');

describe('interpolateMarkdownRefs', () => {
	it('resolves count ref', () => {
		const cells = [makeCell('orders', [{ id: 1 }, { id: 2 }, { id: 3 }])];
		const out = interpolateMarkdownRefs('Total: {{orders.count}}', cells);
		expect(strip(out)).toBe('Total: 3');
	});

	it('resolves columns ref', () => {
		const cells = [makeCell('orders', [{ id: 1, month: 'Jan' }], ['id', 'month'])];
		const out = interpolateMarkdownRefs('Cols: {{orders.columns}}', cells);
		expect(strip(out)).toBe('Cols: id, month');
	});

	it('resolves first-row field ref', () => {
		const cells = [makeCell('orders', [{ revenue: 42000 }])];
		const out = interpolateMarkdownRefs('Rev: {{orders.revenue}}', cells);
		expect(strip(out)).toBe('Rev: 42,000');
	});

	it('resolves indexed row ref', () => {
		const cells = [makeCell('orders', [{ month: 'Jan' }, { month: 'Feb' }])];
		const out = interpolateMarkdownRefs('Second: {{orders[1].month}}', cells);
		expect(strip(out)).toBe('Second: Feb');
	});

	it('shows not-run placeholder when cell has no result', () => {
		const cell = { id: 'x', outputName: 'orders', cellType: 'query', result: null } as unknown as Cell;
		const out = interpolateMarkdownRefs('{{orders.count}}', [cell]);
		expect(out).toContain('not run');
		expect(out).toContain('md-live-ref--missing');
	});

	it('shows missing placeholder when column not found', () => {
		const cells = [makeCell('orders', [{ id: 1 }])];
		const out = interpolateMarkdownRefs('{{orders.revenue}}', cells);
		expect(out).toContain('not found');
		expect(out).toContain('md-live-ref--missing');
	});

	it('shows missing placeholder for out-of-range row index', () => {
		const cells = [makeCell('orders', [{ id: 1 }])];
		const out = interpolateMarkdownRefs('{{orders[5].id}}', cells);
		expect(out).toContain('row 5 missing');
	});

	it('formats null values as em-dash', () => {
		const cells = [makeCell('orders', [{ revenue: null }])];
		const out = interpolateMarkdownRefs('{{orders.revenue}}', cells);
		expect(strip(out)).toBe('—');
	});

	it('leaves non-ref text unchanged', () => {
		const cells = [makeCell('orders', [{ id: 1 }])];
		const out = interpolateMarkdownRefs('Hello world', cells);
		expect(out).toBe('Hello world');
	});

	it('handles bad ref syntax gracefully', () => {
		const out = interpolateMarkdownRefs('{{bad ref!}}', []);
		expect(out).toContain('bad ref');
		expect(out).toContain('md-live-ref--missing');
	});

	it('wraps resolved values in md-live-ref span', () => {
		const cells = [makeCell('orders', [{ id: 1 }, { id: 2 }])];
		const out = interpolateMarkdownRefs('{{orders.count}}', cells);
		expect(out).toContain('class="md-live-ref"');
		expect(out).not.toContain('md-live-ref--missing');
	});
});

describe('extractMarkdownRefs', () => {
	it('extracts unique outputNames from refs', () => {
		const refs = extractMarkdownRefs('{{orders.count}} and {{orders.revenue}} and {{users.count}}');
		expect(refs).toContain('orders');
		expect(refs).toContain('users');
		expect(refs).toHaveLength(2);
	});

	it('returns empty array for no refs', () => {
		expect(extractMarkdownRefs('plain text')).toEqual([]);
	});
});
