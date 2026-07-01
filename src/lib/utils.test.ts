import { describe, expect, it } from 'vitest';

import {
	coerceNumber,
	inferChartConfig,
	inferSmartChartConfig,
	inferSmartChartConfigForType,
	normalizeChartConfig,
	recommendChartTypes
} from '$lib/utils';

describe('coerceNumber', () => {
	it('parses formatted numeric strings and handles empty values', () => {
		expect(coerceNumber('1,234.5')).toBe(1234.5);
		expect(coerceNumber('')).toBeNull();
		expect(coerceNumber(null)).toBeNull();
	});

	it('parses escaped quoted numeric strings from csv/sql payloads', () => {
		expect(coerceNumber('"\\"5300\\""')).toBe(5300);
		expect(coerceNumber('"5300"')).toBe(5300);
		expect(coerceNumber('(1,250)')).toBe(-1250);
	});

	it('returns null for non-numeric strings', () => {
		expect(coerceNumber('not-a-number')).toBeNull();
	});
});

describe('inferChartConfig', () => {
	it('prefers a date x-axis with numeric y-series and line chart', () => {
		const rows = [
			{ ds: '2026-01-01', sales: 10, region: 'east' },
			{ ds: '2026-01-02', sales: 20, region: 'west' }
		];
		const config = inferChartConfig(['ds', 'sales', 'region'], rows);

		expect(config.chartType).toBe('line');
		expect(config.xColumn).toBe('ds');
		expect(config.yColumns).toEqual(['sales']);
	});

	it('returns empty y-series when there are no numeric columns', () => {
		const rows = [
			{ country: 'KE', city: 'Nairobi' },
			{ country: 'UG', city: 'Kampala' }
		];
		const config = inferChartConfig(['country', 'city'], rows);

		expect(config.yColumns).toEqual([]);
	});

	it('detects numeric strings as numeric for csv-like rows', () => {
		const rows = [
			{ month: 'March', total: '43849.44' },
			{ month: 'July', total: '17336.90' },
			{ month: 'April', total: '-101016.27' }
		];
		const config = inferChartConfig(['month', 'total'], rows);

		expect(config.xColumn).toBe('month');
		expect(config.yColumns).toEqual(['total']);
	});

	it('handles monthly.csv style columns and padded month labels', () => {
		const rows = [
			{ 'transactions_view.month_name': 'March    ', 'transactions_view.total_amount': '43849.44' },
			{ 'transactions_view.month_name': 'July     ', 'transactions_view.total_amount': '17336.90' },
			{ 'transactions_view.month_name': 'June     ', 'transactions_view.total_amount': '-6394.48' }
		];
		const config = inferChartConfig(
			['transactions_view.month_name', 'transactions_view.total_amount'],
			rows
		);

		expect(config.xColumn).toBe('transactions_view.month_name');
		expect(config.yColumns).toEqual(['transactions_view.total_amount']);
	});

	it('detects escaped quoted numeric values as numeric columns', () => {
		const rows = [
			{ city: 'Addis Ababa', sum_rent_usd: '"\\"5300\\""' },
			{ city: 'Nairobi', sum_rent_usd: '"\\"4100\\""' }
		];
		const config = inferChartConfig(['city', 'sum_rent_usd'], rows);

		expect(config.xColumn).toBe('city');
		expect(config.yColumns).toEqual(['sum_rent_usd']);
	});
});

describe('recommendChartTypes', () => {
	it('prioritizes line for time-series numeric data', () => {
		const rows = [
			{ ds: '2026-01-01', sales: 10 },
			{ ds: '2026-01-02', sales: 20 }
		];
		const recommendations = recommendChartTypes(['ds', 'sales'], rows);

		expect(recommendations[0]?.chartType).toBe('line');
		expect(recommendations[0]?.reason.toLowerCase()).toContain('trend');
	});

	it('includes pie when category cardinality is low', () => {
		const rows = [
			{ region: 'east', sales: 10 },
			{ region: 'west', sales: 20 },
			{ region: 'east', sales: 30 }
		];
		const recommendations = recommendChartTypes(['region', 'sales'], rows);

		expect(recommendations.map((r) => r.chartType)).toContain('pie');
		expect(recommendations.map((r) => r.chartType)).toContain('bar');
	});
});

describe('inferSmartChartConfig', () => {
	it('prefers scatter with numeric x/y for measure-only datasets', () => {
		const rows = [
			{ revenue: 100, profit: 30, margin: 0.3 },
			{ revenue: 120, profit: 25, margin: 0.21 }
		];
		const config = inferSmartChartConfig(['revenue', 'profit', 'margin'], rows);

		expect(['scatter', 'bubble']).toContain(config.chartType);
		expect(config.xColumn).toBe('revenue');
		expect(config.yColumns).toEqual(['profit']);
	});

	it('prefers bar with category x and numeric y for low-cardinality category data', () => {
		const rows = [
			{ region: 'east', sales: 10 },
			{ region: 'west', sales: 20 },
			{ region: 'east', sales: 30 }
		];
		const config = inferSmartChartConfig(['region', 'sales'], rows);

		expect(config.chartType).toBe('bar');
		expect(config.xColumn).toBe('region');
		expect(config.yColumns).toEqual(['sales']);
	});

	it('uses low-cardinality dimension for x and secondary dimension for color in 2D+1M', () => {
		const rows = [
			{ city: 'Nairobi', property_type: 'Office', sum_rent_usd: 4100 },
			{ city: 'Nakuru', property_type: 'Warehouse', sum_rent_usd: 4800 },
			{ city: 'Mombasa', property_type: 'Retail', sum_rent_usd: 2100 },
			{ city: 'Kampala', property_type: 'Office', sum_rent_usd: 3200 },
			{ city: 'Kigali', property_type: 'Office', sum_rent_usd: 2950 },
			{ city: 'Addis Ababa', property_type: 'Warehouse', sum_rent_usd: 5300 },
			{ city: 'Dar es Salaam', property_type: 'Office', sum_rent_usd: 2750 },
			{ city: 'Lusaka', property_type: 'Retail', sum_rent_usd: 1800 }
		];
		const config = inferSmartChartConfig(['city', 'property_type', 'sum_rent_usd'], rows);

		expect(config.chartType).toBe('bar');
		expect(config.xColumn).toBe('property_type');
		expect(config.colorColumn).toBe('city');
		expect(config.seriesMode).toBe('grouped');
		expect(config.yColumns).toEqual(['sum_rent_usd']);
	});
});

describe('normalizeChartConfig', () => {
	it('adds defaults for additive chart fields', () => {
		const normalized = normalizeChartConfig({
			chartType: 'line',
			xColumn: 'ds',
			yColumns: ['sales'],
			colorColumn: null
		});

		expect(normalized.sizeColumn).toBeNull();
		expect(normalized.yColumnsSecondary).toEqual([]);
		expect(normalized.seriesMode).toBe('auto');
		expect(normalized.recommendation).toBeNull();
	});
});

describe('inferSmartChartConfigForType', () => {
	it('assigns bubble size metric when switching to bubble chart type', () => {
		const rows = [
			{ revenue: 100, profit: 30, margin: 0.3 },
			{ revenue: 120, profit: 25, margin: 0.21 },
			{ revenue: 130, profit: 28, margin: 0.24 }
		];
		const config = inferSmartChartConfigForType(['revenue', 'profit', 'margin'], rows, 'bubble');

		expect(config.chartType).toBe('bubble');
		expect(config.xColumn).toBe('revenue');
		expect(config.yColumns).toEqual(['profit']);
		expect(config.sizeColumn).toBe('margin');
	});

	it('splits high-cardinality multi-metric trend shapes into primary and secondary axis series', () => {
		const rows = Array.from({ length: 40 }, (_, i) => ({
			ds: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
			revenue: 1000 + i * 20,
			cost: 600 + i * 10,
			profit: 400 + i * 8,
			units: 50 + i
		}));
		const config = inferSmartChartConfigForType(
			['ds', 'revenue', 'cost', 'profit', 'units'],
			rows,
			'line'
		);

		expect(config.yColumns.length).toBeGreaterThan(0);
		expect((config.yColumnsSecondary ?? []).length).toBeGreaterThan(0);
		expect(config.yColumnsSecondary?.every((col) => !config.yColumns.includes(col))).toBe(true);
	});

	it('preserves intelligent x-axis choice when switching to bar type', () => {
		const rows = [
			{ city: 'Nairobi', property_type: 'Office', sum_rent_usd: 4100 },
			{ city: 'Nakuru', property_type: 'Warehouse', sum_rent_usd: 4800 },
			{ city: 'Mombasa', property_type: 'Retail', sum_rent_usd: 2100 },
			{ city: 'Kampala', property_type: 'Office', sum_rent_usd: 3200 },
			{ city: 'Kigali', property_type: 'Office', sum_rent_usd: 2950 },
			{ city: 'Addis Ababa', property_type: 'Warehouse', sum_rent_usd: 5300 }
		];

		const config = inferSmartChartConfigForType(
			['city', 'property_type', 'sum_rent_usd'],
			rows,
			'bar'
		);

		expect(config.xColumn).toBe('property_type');
		expect(config.colorColumn).toBe('city');
		expect(config.yColumns).toEqual(['sum_rent_usd']);
	});
});
