import { describe, expect, it } from 'vitest';
import { SUBAGENT_TOOLS } from '$lib/services/ai-subagents.js';
import { NATIVE_TOOLS } from '$lib/agent/server/tools/native-schemas.js';
import { getAgentTool, listAgentTools, isStopAfterTool } from './registry.js';

describe('agent tool registry', () => {
	it('includes node-native notebook tools as either-executor mutating tools', () => {
		// 'either' (not 'client') — these now have a real server-side implementation
		// too (notebook-mutation.ts), reachable headlessly via MCP/REST, in addition
		// to their original client (browser store) execution path.
		const t = getAgentTool('apply_notebook_patch');
		expect(t?.executor).toBe('either');
		expect(t?.mutates).toBe(true);
		expect(getAgentTool('create_notebook')?.mutates).toBe(true);
		expect(getAgentTool('create_notebook')?.executor).toBe('either');
		expect(getAgentTool('create_cell')).toBeUndefined();
	});

	it('includes MCP server tools', () => {
		expect(getAgentTool('list_capabilities')?.executor).toBe('server');
		expect(getAgentTool('get_visual_report_grammar')?.executor).toBe('server');
		expect(getAgentTool('run_workflow')?.mutates).toBe(true);
		expect(getAgentTool('delete_resource')?.mutates).toBe(true);
		expect(getAgentTool('dbt_run')?.executor).toBe('server');
		expect(getAgentTool('dbt_run')?.mutates).toBe(true);
		expect(getAgentTool('publish_notebook')?.mutates).toBe(true);
		expect(getAgentTool('run_query')?.stopAfter).toBe(true);
	});

	it('filters by executor', () => {
		const server = listAgentTools({ executor: 'server' });
		expect(server.every((t) => t.executor === 'server')).toBe(true);
		expect(server.some((t) => t.name === 'list_connections')).toBe(true);
	});

	it('schemasForMcp includes both server and either executor tools', async () => {
		const { schemasForMcp } = await import('./registry.js');
		const names = new Set(schemasForMcp().map((t) => t.name));
		expect(names.has('list_capabilities')).toBe(true);
		expect(names.has('get_visual_report_grammar')).toBe(true);
		expect(names.has('validate_workflow')).toBe(true);
		expect(names.has('run_workflow')).toBe(true);
		expect(names.has('list_connections')).toBe(true); // executor: 'server'
		expect(names.has('create_notebook')).toBe(true); // executor: 'either'
		expect(names.has('query_data')).toBe(true); // executor: 'either'
	});

	it('maps stop-after tools', () => {
		expect(isStopAfterTool('run_query_nodes')).toBe(true);
		expect(isStopAfterTool('inspect_notebook')).toBe(false);
	});

	it('has native schemas for every subagent tool', () => {
		const nativeNames = new Set(NATIVE_TOOLS.map((tool) => tool.function.name));
		const missing = Object.entries(SUBAGENT_TOOLS).flatMap(([phase, tools]) =>
			tools.filter((tool) => !nativeNames.has(tool)).map((tool) => `${phase}:${tool}`)
		);

		expect(missing).toEqual([]);
	});
});
