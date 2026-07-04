import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	detectLatLonColumns,
	hasGeoPointData
} from './geo-columns';
import { inferChartConfig, inferSmartChartConfigForType } from '$lib/utils';

const fixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'../../../e2e/fixtures/countries.csv'
);

function parseCountriesCsv(): Record<string, unknown>[] {
	const text = readFileSync(fixturePath, 'utf-8');
	const lines = text.trim().split('\n');
	const headers = lines[0]!.split(',');
	return lines.slice(1).map((line) => {
		// Simple CSV parse — fixture has quoted names only when needed
		const values: string[] = [];
		let current = '';
		let inQuotes = false;
		for (const ch of line) {
			if (ch === '"') {
				inQuotes = !inQuotes;
				continue;
			}
			if (ch === ',' && !inQuotes) {
				values.push(current);
				current = '';
				continue;
			}
			current += ch;
		}
		values.push(current);
		const row: Record<string, unknown> = {};
		for (let i = 0; i < headers.length; i++) {
			const key = headers[i]!.trim();
			const raw = values[i]?.trim() ?? '';
			if (key === 'latitude' || key === 'longitude') {
				row[key] = raw === '' ? null : Number(raw);
			} else {
				row[key] = raw;
			}
		}
		return row;
	});
}

describe('countries.csv map visualization', () => {
	const rows = parseCountriesCsv();
	const columns = ['country', 'latitude', 'longitude', 'name'];

	it('loads the full countries fixture', () => {
		expect(rows.length).toBeGreaterThan(200);
		expect(rows[0]).toMatchObject({ country: 'AD', name: 'Andorra' });
	});

	it('detects latitude/longitude columns', () => {
		expect(hasGeoPointData(columns, rows)).toBe(true);
		expect(detectLatLonColumns(columns, rows)).toEqual({
			latColumn: 'latitude',
			lonColumn: 'longitude'
		});
	});

	it('infers map chart type from countries data', () => {
		const config = inferChartConfig(columns, rows);
		expect(config.chartType).toBe('map');
		expect(config.latColumn).toBe('latitude');
		expect(config.lonColumn).toBe('longitude');
	});

	it('configures map with name as label column', () => {
		const config = inferSmartChartConfigForType(columns, rows, 'map');
		expect(config.chartType).toBe('map');
		expect(config.latColumn).toBe('latitude');
		expect(config.lonColumn).toBe('longitude');
		expect(config.colorColumn).toBe('name');
	});

	it('filters rows missing coordinates (UM territory)', () => {
		const um = rows.find((r) => r.country === 'UM');
		expect(um?.latitude).toBeNull();
		const valid = rows.filter(
			(r) => typeof r.latitude === 'number' && typeof r.longitude === 'number'
		);
		expect(valid.length).toBe(rows.length - 1);
	});
});
