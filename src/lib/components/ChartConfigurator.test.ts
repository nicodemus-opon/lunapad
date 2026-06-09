import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
// Logic now lives in ChartConfigPanel; ChartConfigurator is the Popover wrapper.
const panelPath = resolve(currentDir, './ChartConfigPanel.svelte');
const configuratorPath = resolve(currentDir, './ChartConfigurator.svelte');

describe('ChartConfigurator recommendations panel', () => {
	it('does not render the Recommended section', () => {
		const panel = readFileSync(panelPath, 'utf8');
		expect(panel).not.toContain('>Recommended<');
		expect(panel).not.toContain('chartRecommendations');
	});

	it('uses smart config selection when switching chart types and exposes secondary-axis controls', () => {
		const panel = readFileSync(panelPath, 'utf8');
		expect(panel).toContain('inferSmartChartConfigForType');
		expect(panel).toContain('setChartTypeSmart(ct.type)');
		expect(panel).toContain('supportsSecondaryAxis');
		expect(panel).toContain('Secondary Y');
	});

	it('ChartConfigurator wraps ChartConfigPanel in a Popover', () => {
		const configurator = readFileSync(configuratorPath, 'utf8');
		expect(configurator).toContain('ChartConfigPanel');
		expect(configurator).toContain('Popover');
	});
});
