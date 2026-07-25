import { describe, it, expect } from 'vitest';
import { CORE_TOOLS, DEFERRED_TOOL_HINTS, findDeferredTools } from './tool-search-catalog.js';

describe('tool-search-catalog', () => {
	it('CORE_TOOLS and DEFERRED_TOOL_HINTS are disjoint', () => {
		const core = new Set(CORE_TOOLS);
		for (const { name } of DEFERRED_TOOL_HINTS) {
			expect(core.has(name)).toBe(false);
		}
	});

	it('CORE_TOOLS always includes find_tools itself', () => {
		expect(CORE_TOOLS).toContain('find_tools');
	});

	it('finds a deferred tool by describing the task, not just the tool name', () => {
		const matches = findDeferredTools('change the chart type to a pie chart');
		expect(matches.some((m) => m.name === 'set_chart')).toBe(true);
	});

	it('finds get_lineage for a dependency question', () => {
		const matches = findDeferredTools('what depends on this cell downstream');
		expect(matches.some((m) => m.name === 'get_lineage')).toBe(true);
	});

	it('returns nothing for an empty or nonsense query', () => {
		expect(findDeferredTools('')).toEqual([]);
		expect(findDeferredTools('xyz123 qqqzzz')).toEqual([]);
	});
});
