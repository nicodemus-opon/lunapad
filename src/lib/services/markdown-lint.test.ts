import { describe, it, expect } from 'vitest';
import { detectHardcodedValues, detectHardcodedTextValues, detectHardcodedContent } from './markdown-lint.js';
import type { Cell } from '$lib/stores/notebook.svelte';

function makeCell(outputName: string, rows: Record<string, unknown>[]): Cell {
	return {
		id: outputName,
		outputName,
		cellType: 'query',
		result: { rows, columns: Object.keys(rows[0] ?? {}), truncated: false }
	} as unknown as Cell;
}

describe('detectHardcodedValues', () => {
	it('flags a hardcoded currency value', () => {
		const hint = detectHardcodedValues('Revenue: $42,000 this month.');
		expect(hint).toContain('$42,000');
	});

	it('flags a hardcoded percentage', () => {
		const hint = detectHardcodedValues('Null rate is 23% in this table.');
		expect(hint).toContain('23%');
	});

	it('flags a hardcoded comma-grouped number', () => {
		const hint = detectHardcodedValues('We had 1,234,567 events last week.');
		expect(hint).toContain('1,234,567');
	});

	it('flags a bare large number', () => {
		const hint = detectHardcodedValues('Total orders: 84213.');
		expect(hint).toContain('84213');
	});

	it('does not flag legacy {{}} live refs', () => {
		expect(detectHardcodedValues('Revenue: {{orders.revenue}} this month.')).toBeNull();
	});

	it('does not flag Markdoc tags', () => {
		expect(detectHardcodedValues('{% metric value=$orders.revenue label="Revenue" /%}')).toBeNull();
		expect(detectHardcodedValues('{% grid cols=2 %}{% metric value=$orders.revenue vs=$prev.revenue /%}{% /grid %}')).toBeNull();
	});

	it('does not flag a 4-digit year', () => {
		expect(detectHardcodedValues('In Q2 2026 we launched the new pricing tier.')).toBeNull();
	});

	it('does not flag small numbers in prose (step numbers, headings, counts)', () => {
		expect(detectHardcodedValues('Step 5 — Document')).toBeNull();
		expect(detectHardcodedValues('## 3. Findings')).toBeNull();
		expect(detectHardcodedValues('Top 5 products by revenue')).toBeNull();
	});

	it('does not flag plain prose with no numbers', () => {
		expect(detectHardcodedValues('## Summary\nEverything looks clean.')).toBeNull();
	});

	it('does not double-report a number inside a flagged currency span', () => {
		const hint = detectHardcodedValues('Revenue: $1500 flat.');
		const occurrences = (hint?.match(/1500/g) ?? []).length;
		expect(occurrences).toBe(1);
	});

	it('mixed content: live refs pass through untouched, hardcoded numbers still flagged', () => {
		const hint = detectHardcodedValues('Orders: {{orders.count}}. Revenue: $99,999 (hardcoded).');
		expect(hint).toContain('$99,999');
		expect(hint).not.toContain('orders.count');
	});
});

describe('detectHardcodedTextValues', () => {
	it('flags a hardcoded status string that matches a real row value', () => {
		const cells = [makeCell('accounts', [{ status: 'delinquent' }, { status: 'current' }])];
		const hint = detectHardcodedTextValues('Most accounts are delinquent this quarter.', cells);
		expect(hint).toContain('delinquent');
	});

	it('flags a hardcoded multi-word value, preferring the longer match', () => {
		const cells = [makeCell('offices', [{ city: 'San Francisco' }])];
		const hint = detectHardcodedTextValues('Most signups came from San Francisco last week.', cells);
		expect(hint).toContain('San Francisco');
	});

	it('does not flag live refs', () => {
		const cells = [makeCell('accounts', [{ status: 'delinquent' }])];
		expect(detectHardcodedTextValues('Status: {{accounts.status}}.', cells)).toBeNull();
		expect(detectHardcodedTextValues('{% badge value=$accounts.status /%}', cells)).toBeNull();
	});

	it('does not flag stoplist words even if they appear in row data', () => {
		const cells = [makeCell('flags', [{ active: 'true' }, { note: 'n/a' }])];
		expect(detectHardcodedTextValues('This is true, not n/a.', cells)).toBeNull();
	});

	it('does not flag prose that has no overlap with any row value', () => {
		const cells = [makeCell('accounts', [{ status: 'delinquent' }])];
		expect(detectHardcodedTextValues('Everything looks clean today.', cells)).toBeNull();
	});

	it('ignores non-string and numeric-shaped values', () => {
		const cells = [makeCell('orders', [{ count: 42, ratio: '12%' }])];
		expect(detectHardcodedTextValues('We saw 42 orders at a 12% ratio.', cells)).toBeNull();
	});
});

describe('detectHardcodedContent', () => {
	it('catches numeric hardcoding even with no cells', () => {
		expect(detectHardcodedContent('Revenue: $42,000.', [])).toContain('$42,000');
	});

	it('catches text hardcoding when numeric check passes', () => {
		const cells = [makeCell('accounts', [{ status: 'delinquent' }])];
		expect(detectHardcodedContent('Most are delinquent.', cells)).toContain('delinquent');
	});

	it('returns null when neither check fires', () => {
		const cells = [makeCell('accounts', [{ status: 'delinquent' }])];
		expect(detectHardcodedContent('All clear here.', cells)).toBeNull();
	});
});
