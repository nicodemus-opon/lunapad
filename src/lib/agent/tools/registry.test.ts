import { describe, expect, it } from 'vitest';
import { getAgentTool, listAgentTools, isStopAfterTool } from './registry.js';

describe('agent tool registry', () => {
	it('includes create_cell as client mutating tool', () => {
		const t = getAgentTool('create_cell');
		expect(t?.executor).toBe('client');
		expect(t?.mutates).toBe(true);
	});

	it('includes MCP server tools', () => {
		expect(getAgentTool('dbt_run')?.executor).toBe('server');
		expect(getAgentTool('run_query')?.stopAfter).toBe(true);
	});

	it('filters by executor', () => {
		const server = listAgentTools({ executor: 'server' });
		expect(server.every((t) => t.executor === 'server')).toBe(true);
		expect(server.some((t) => t.name === 'list_connections')).toBe(true);
	});

	it('maps stop-after tools', () => {
		expect(isStopAfterTool('run_cells')).toBe(true);
		expect(isStopAfterTool('create_cell')).toBe(false);
	});
});
