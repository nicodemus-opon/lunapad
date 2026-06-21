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
		expect(out).toContain('md-live-ref--missing');
	});

	it('wraps resolved values in md-live-ref span', () => {
		const cells = [makeCell('orders', [{ id: 1 }, { id: 2 }])];
		const out = interpolateMarkdownRefs('{{orders.count}}', cells);
		expect(out).toContain('class="md-live-ref"');
		expect(out).not.toContain('md-live-ref--missing');
	});

	it('rowCount is an alias for count', () => {
		const cells = [makeCell('orders', [{ id: 1 }, { id: 2 }, { id: 3 }])];
		const out = interpolateMarkdownRefs('Total: {{orders.rowCount}}', cells);
		expect(strip(out)).toBe('Total: 3');
	});

	it('resolves column-first indexed ref name.col[N]', () => {
		const cells = [makeCell('orders', [{ month: 'Jan' }, { month: 'Feb' }])];
		const out = interpolateMarkdownRefs('Second: {{orders.month[1]}}', cells);
		expect(strip(out)).toBe('Second: Feb');
	});

	it('resolves negative index name.col[-1] as last row', () => {
		const cells = [makeCell('orders', [{ month: 'Jan' }, { month: 'Feb' }, { month: 'Mar' }])];
		const out = interpolateMarkdownRefs('Last: {{orders.month[-1]}}', cells);
		expect(strip(out)).toBe('Last: Mar');
	});

	it('evaluates simple arithmetic expression', () => {
		const cells = [makeCell('orders', [{ id: 1 }, { id: 2 }, { id: 3 }])];
		const out = interpolateMarkdownRefs('N-1: {{orders.count - 1}}', cells);
		expect(strip(out)).toBe('N-1: 2');
	});

	it('evaluates compound expression with | round filter', () => {
		const a = makeCell('sales', [{ revenue: 150 }]);
		const b = makeCell('totals', [{ id: 1 }, { id: 2 }]);
		const out = interpolateMarkdownRefs('Pct: {{(sales.revenue[0] * 100 / totals.count) | round(1)}}', [a, b]);
		expect(strip(out)).toBe('Pct: 7500.0');
	});

	it('evaluates cross-cell arithmetic with rowCount', () => {
		const a = makeCell('subset', [{ val: 25 }]);
		const b = makeCell('all', [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
		const out = interpolateMarkdownRefs('Share: {{(subset.val[0] * 100 / all.rowCount) | round(1)}}', [a, b]);
		expect(strip(out)).toBe('Share: 625.0');
	});

	it('evaluates a percent() formatter call over a share-of-total ratio of refs', () => {
		const a = makeCell('by_level', [{ opportunity_count: 50 }]);
		const b = makeCell('overall', [{ total_opportunities: 200 }]);
		// percent() expects an already-0-100-scaled value, so a share-of-total ratio
		// must be multiplied by 100 first — same convention as the Markdoc renderer.
		const out = interpolateMarkdownRefs(
			'{{percent(by_level[0].opportunity_count * 100 / overall.total_opportunities, 1)}}',
			[a, b]
		);
		expect(strip(out)).toBe('25.0%');
	});

	it('evaluates currency(), compact(), and sign() formatter calls', () => {
		const cells = [makeCell('orders', [{ revenue: 42000, big: 1500000, delta: -12 }])];
		expect(strip(interpolateMarkdownRefs('{{currency(orders.revenue)}}', cells))).toBe('$42,000');
		expect(strip(interpolateMarkdownRefs('{{compact(orders.big)}}', cells))).toBe('1.5M');
		expect(strip(interpolateMarkdownRefs('{{sign(orders.delta)}}', cells))).toBe('-12');
	});

	it('evaluates formatDate() over a string-valued ref — any Markdoc function works here, not just numeric ones', () => {
		const cells = [makeCell('orders', [{ ts: '2026-03-05T00:00:00Z' }])];
		const out = interpolateMarkdownRefs('{{formatDate(orders.ts, "MMM YYYY")}}', cells);
		expect(strip(out)).toBe('Mar 2026');
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
