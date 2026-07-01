import { describe, it, expect } from 'vitest';
import {
	buildHistogramBuckets,
	computeColumnProfile,
	computeDatasetOverview,
	computeProfilesFromRows,
	collectQualityHints,
	defaultSelectedColumn,
	mapDuckDbProfile,
	quantile
} from './column-profile.js';

describe('column-profile', () => {
	it('computes quantiles', () => {
		expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
		expect(quantile([10], 0.5)).toBe(10);
		expect(quantile([], 0.5)).toBeNull();
	});

	it('builds histogram buckets', () => {
		const buckets = buildHistogramBuckets([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
		expect(buckets).toHaveLength(5);
		expect(buckets!.reduce((a, b) => a + b, 0)).toBe(10);
	});

	it('profiles numeric column with histogram', () => {
		const rows = [
			{ amount: 10 },
			{ amount: 20 },
			{ amount: 30 },
			{ amount: null }
		];
		const profile = computeColumnProfile(rows, 'amount');
		expect(profile.nullCount).toBe(1);
		expect(profile.nullPct).toBe(25);
		expect(profile.numeric?.min).toBe(10);
		expect(profile.numeric?.max).toBe(30);
		expect(profile.numeric?.histogramBuckets).not.toBeNull();
		expect(profile.highNull).toBe(true);
	});

	it('profiles boolean column', () => {
		const rows = [
			{ active: true },
			{ active: false },
			{ active: true }
		];
		const profile = computeColumnProfile(rows, 'active');
		expect(profile.boolean?.trueCount).toBe(2);
		expect(profile.boolean?.falseCount).toBe(1);
	});

	it('profiles text column lengths', () => {
		const rows = [{ name: 'ab' }, { name: '' }, { name: 'hello' }];
		const profile = computeColumnProfile(rows, 'name');
		expect(profile.text?.emptyCount).toBe(1);
		expect(profile.text?.minLen).toBe(0);
		expect(profile.text?.maxLen).toBe(5);
	});

	it('profiles temporal column', () => {
		const rows = [
			{ created_at: '2024-01-01' },
			{ created_at: '2024-06-01' }
		];
		const profile = computeColumnProfile(rows, 'created_at');
		expect(profile.temporal?.min).toBe('2024-01-01');
		expect(profile.temporal?.max).toBe('2024-06-01');
		expect(profile.temporal?.rangeDays).toBeGreaterThan(0);
	});

	it('computes dataset overview', () => {
		const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
		const profiles = computeProfilesFromRows(rows, ['a', 'b']);
		const overview = computeDatasetOverview(profiles, { name: 'test', rowCount: 2 });
		expect(overview.rowCount).toBe(2);
		expect(overview.columnCount).toBe(2);
		expect(overview.numericColumnCount).toBe(1);
	});

	it('maps DuckDB summarize row', () => {
		const profile = mapDuckDbProfile(
			{
				column_name: 'amount',
				column_type: 'DOUBLE',
				min: '1.5',
				max: '99.0',
				approx_unique: 50,
				avg: '25.5',
				std: '10.2',
				q25: '10',
				q50: '20',
				q75: '40',
				count: 100,
				null_percentage: '5.0'
			},
			{
				totalRows: 100,
				topValues: [{ val: '10', cnt: 5 }],
				skew: 0.5,
				kurt: 1.2
			}
		);
		expect(profile.column).toBe('amount');
		expect(profile.typeLabel).toBe('double');
		expect(profile.numeric?.mean).toBe(25.5);
		expect(profile.numeric?.skew).toBe(0.5);
		expect(profile.topValues[0].count).toBe(5);
	});

	it('collects quality hints', () => {
		const profiles = [
			computeColumnProfile([{ x: null }, { x: null }, { x: 1 }], 'x'),
			computeColumnProfile([{ id: 1 }, { id: 2 }, { id: 3 }], 'id')
		];
		const hints = collectQualityHints(profiles, { truncated: true });
		expect(hints.some((h) => h.includes('null'))).toBe(true);
		expect(hints.some((h) => h.includes('1,000'))).toBe(true);
	});

	it('picks default selected column from flags', () => {
		const profiles = computeProfilesFromRows(
			[{ a: 1, b: null }, { a: 2, b: null }],
			['a', 'b']
		);
		expect(defaultSelectedColumn(profiles)).toBe('b');
	});
});
