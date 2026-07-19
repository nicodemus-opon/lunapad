import { describe, expect, it } from 'vitest';
import { MCP_TOOL_ACTIONS, can, canResolveThread, normalizeRole, hasApiScope } from './permissions';

describe('permissions', () => {
	it('normalizes legacy user role to editor', () => {
		expect(normalizeRole('user')).toBe('editor');
		expect(normalizeRole(null)).toBe('editor');
	});

	it('grants admin full workspace write', () => {
		expect(can({ id: '1', role: 'admin' }, 'workspace:write')).toBe(true);
		expect(can({ id: '1', role: 'admin' }, 'shares:publish')).toBe(true);
	});

	it('blocks viewer from publishing shares', () => {
		expect(can({ id: '1', role: 'viewer' }, 'shares:publish')).toBe(false);
		expect(can({ id: '1', role: 'viewer' }, 'sites:manage')).toBe(false);
		expect(can({ id: '1', role: 'viewer' }, 'comments:write')).toBe(true);
	});

	it('grants editor sites manage', () => {
		expect(can({ id: '1', role: 'editor' }, 'sites:manage')).toBe(true);
	});

	it('blocks viewer from ai mutations', () => {
		expect(can({ id: '1', role: 'viewer' }, 'ai:mutate')).toBe(false);
		expect(can({ id: '1', role: 'viewer' }, 'ai:read')).toBe(true);
		expect(can({ id: '1', role: 'editor' }, 'ai:mutate')).toBe(true);
	});

	it('allows thread creator to resolve', () => {
		expect(
			canResolveThread({ id: 'u1', role: 'editor' }, { createdBy: 'u1', assigneeId: null })
		).toBe(true);
	});

	it('treats empty/unscoped api keys as read-only, not full access', () => {
		expect(hasApiScope(null, 'workspace:read')).toBe(true);
		expect(hasApiScope(null, 'connections:query')).toBe(true);
		expect(hasApiScope(null, 'workspace:write')).toBe(false);
		expect(hasApiScope([], 'workspace:write')).toBe(false);
		expect(hasApiScope(['workspace:read'], 'workspace:write')).toBe(false);
	});

	it('grants everything via the automation:full scope sentinel', () => {
		expect(hasApiScope(['automation:full'], 'workspace:write')).toBe(true);
		expect(hasApiScope(['automation:full'], 'dbt:run')).toBe(true);
	});

	it('grants an explicitly listed scope', () => {
		expect(hasApiScope(['workspace:write'], 'workspace:write')).toBe(true);
		expect(hasApiScope(['workspace:write'], 'dbt:run')).toBe(false);
	});

	it('marks data-app registry helpers as read-only MCP tools', () => {
		expect(MCP_TOOL_ACTIONS.get_component_capabilities).toBe('workspace:read');
		expect(MCP_TOOL_ACTIONS.get_notebook_app_grammar).toBe('workspace:read');
		expect(MCP_TOOL_ACTIONS.plan_notebook_app).toBe('workspace:read');
		expect(MCP_TOOL_ACTIONS.repair_notebook_blueprint).toBe('workspace:read');
		expect(MCP_TOOL_ACTIONS.score_notebook_blueprint).toBe('workspace:read');
	});
});
