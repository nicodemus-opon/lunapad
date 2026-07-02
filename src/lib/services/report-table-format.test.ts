import { describe, expect, it } from 'vitest';
import {
	formatCellForDisplay,
	formatCellPlainText,
	formatFullValueText
} from './report-table-format';

describe('formatCellPlainText', () => {
	it('renders nullish as em dash', () => {
		expect(formatCellPlainText(null)).toBe('—');
		expect(formatCellPlainText(undefined)).toBe('—');
	});

	it('stringifies objects and truncates long values', () => {
		expect(formatCellPlainText({ a: 1 })).toBe('{"a":1}');
		const long = 'x'.repeat(500);
		const out = formatCellPlainText(long, 10);
		expect(out).toBe('x'.repeat(10) + '…');
	});
});

describe('formatFullValueText', () => {
	it('pretty-prints objects and reports null literally', () => {
		expect(formatFullValueText(null)).toBe('null');
		expect(formatFullValueText({ a: 1 })).toBe('{\n  "a": 1\n}');
	});
});

describe('formatCellForDisplay', () => {
	it('formats booleans as text tokens', () => {
		expect(formatCellForDisplay(true, { kind: 'boolean' }).text).toBe('true');
		expect(formatCellForDisplay(false, { kind: 'boolean' }).text).toBe('false');
	});

	it('returns em dash for nullish regardless of kind', () => {
		expect(formatCellForDisplay(null, { kind: 'number' }).text).toBe('—');
	});

	it('formats percentages with one decimal', () => {
		expect(formatCellForDisplay(12.34, { kind: 'percentage' }).text).toBe('12.3%');
	});

	it('provides a stable category palette seed', () => {
		const a = formatCellForDisplay('north', { kind: 'category' });
		const b = formatCellForDisplay('north', { kind: 'category' });
		expect(a.categorySeed).toBeTypeOf('number');
		expect(a.categorySeed).toBe(b.categorySeed);
	});

	it('truncates long identifiers in the middle', () => {
		const id = 'abcdefghijklmnopqrstuvwxyz';
		const out = formatCellForDisplay(id, { kind: 'id' }).text;
		expect(out).toContain('…');
		expect(out.length).toBeLessThan(id.length);
	});
});
