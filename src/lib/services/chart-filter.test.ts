import { describe, expect, it } from 'vitest';
import {
	plotlyClickToFilterValue,
	resolveChartFilterBinding,
	toggleFilterValue
} from './chart-filter';

describe('chart-filter', () => {
	it('resolves filter binding from attrs', () => {
		expect(resolveChartFilterBinding({ filterParam: 'region', xColumn: 'region' })).toEqual({
			param: 'region',
			column: 'region'
		});
		expect(resolveChartFilterBinding({ filterParam: 'region', filterColumn: 'r' })).toEqual({
			param: 'region',
			column: 'r'
		});
		expect(resolveChartFilterBinding({ filterParam: '' })).toBeNull();
	});

	it('maps plotly click to string value', () => {
		expect(plotlyClickToFilterValue({ x: 'North' })).toBe('North');
		expect(plotlyClickToFilterValue({ label: 42 })).toBe('42');
	});

	it('toggles filter selection', () => {
		expect(toggleFilterValue('North', 'North')).toBe('');
		expect(toggleFilterValue('', 'South')).toBe('South');
		expect(toggleFilterValue('East', 'South')).toBe('South');
	});
});
