import { describe, expect, it } from 'vitest';
import { extractReportFilters, activeFilterChips } from './report-filters';

describe('report-filters', () => {
	it('extracts unique filters from markdown', () => {
		const md = `
{% filter kind="dropdown" param="region" label="Region" options=["North"] /%}
{% filter kind="relative-date" param="range" startParam="start" endParam="end" /%}
{% filter kind="dropdown" param="region" /%}
`;
		const defs = extractReportFilters([md]);
		expect(defs).toHaveLength(2);
		expect(defs[0].param).toBe('region');
		expect(defs[1].kind).toBe('relative-date');
	});

	it('builds active chips', () => {
		const chips = activeFilterChips(
			{ region: 'North', empty: '' },
			new Map([['region', 'Region']])
		);
		expect(chips).toEqual([{ param: 'region', label: 'Region', value: 'North' }]);
	});
});
