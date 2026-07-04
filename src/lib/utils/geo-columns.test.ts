import { describe, expect, it } from 'vitest';
import {
	detectLatLonColumns,
	detectLocationColumn,
	inferGeoScope,
	hasGeoPointData,
	hasChoroplethData
} from './geo-columns';
import { inferSmartChartConfigForType } from '$lib/utils';

describe('detectLatLonColumns', () => {
	it('detects lat/lon from column names and value ranges', () => {
		const rows = [
			{ lat: 40.7, lon: -74.0, name: 'NYC' },
			{ lat: 34.05, lon: -118.24, name: 'LA' }
		];
		expect(detectLatLonColumns(['name', 'lat', 'lon'], rows)).toEqual({
			latColumn: 'lat',
			lonColumn: 'lon'
		});
	});

	it('detects latitude/longitude aliases', () => {
		const rows = [{ latitude: 51.5, longitude: -0.12 }];
		expect(detectLatLonColumns(['latitude', 'longitude', 'value'], rows)).toEqual({
			latColumn: 'latitude',
			lonColumn: 'longitude'
		});
	});
});

describe('detectLocationColumn and inferGeoScope', () => {
	it('prefers ISO-3 country codes', () => {
		const rows = [
			{ country_code: 'USA', revenue: 100 },
			{ country_code: 'GBR', revenue: 80 },
			{ country_code: 'CAN', revenue: 60 }
		];
		expect(detectLocationColumn(['country_code', 'revenue'], rows)).toBe('country_code');
		expect(inferGeoScope('country_code', rows)).toBe('world');
	});

	it('infers US state scope from abbreviations', () => {
		const rows = [
			{ state: 'CA', sales: 10 },
			{ state: 'NY', sales: 20 },
			{ state: 'TX', sales: 15 }
		];
		expect(detectLocationColumn(['state', 'sales'], rows)).toBe('state');
		expect(inferGeoScope('state', rows)).toBe('usa-states');
	});
});

describe('hasGeoPointData / hasChoroplethData', () => {
	it('detects point map data', () => {
		const rows = [{ lat: 1, lon: 2, v: 3 }];
		expect(hasGeoPointData(['lat', 'lon', 'v'], rows)).toBe(true);
		expect(hasChoroplethData(['lat', 'lon', 'v'], rows, ['lat', 'lon', 'v'])).toBe(false);
	});

	it('detects choropleth when location + metric present', () => {
		const rows = [{ country_code: 'USA', revenue: 100 }];
		expect(hasChoroplethData(['country_code', 'revenue'], rows, ['revenue'])).toBe(true);
	});
});

describe('inferSmartChartConfigForType', () => {
	it('picks lat/lon columns for map type', () => {
		const rows = [
			{ store: 'A', lat: 40.7, lon: -74.0, revenue: 100 },
			{ store: 'B', lat: 34.0, lon: -118.2, revenue: 200 }
		];
		const config = inferSmartChartConfigForType(
			['store', 'lat', 'lon', 'revenue'],
			rows,
			'map'
		);
		expect(config.chartType).toBe('map');
		expect(config.latColumn).toBe('lat');
		expect(config.lonColumn).toBe('lon');
		expect(config.yColumns).toContain('revenue');
	});

	it('picks location and metric for choropleth type', () => {
		const rows = [
			{ country_code: 'USA', revenue: 100 },
			{ country_code: 'GBR', revenue: 80 }
		];
		const config = inferSmartChartConfigForType(
			['country_code', 'revenue'],
			rows,
			'choropleth'
		);
		expect(config.chartType).toBe('choropleth');
		expect(config.xColumn).toBe('country_code');
		expect(config.yColumns).toEqual(['revenue']);
		expect(config.geoScope).toBe('world');
	});
});
