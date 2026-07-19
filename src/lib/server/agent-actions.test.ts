import { describe, expect, it } from 'vitest';
import { executeAgentAction, listAgentActions } from './agent-actions.js';

const adminAuth = {
	user: { id: 'u1', role: 'admin' },
	apiKeyId: null,
	apiKeyScopes: null
};

const viewerAuth = {
	user: { id: 'u2', role: 'viewer' },
	apiKeyId: null,
	apiKeyScopes: null
};

describe('agent action registry', () => {
	it('exposes core composability actions', () => {
		const names = new Set(listAgentActions().map((a) => a.name));
		expect(names).toContain('list_capabilities');
		expect(names).toContain('get_visual_report_grammar');
		expect(names).toContain('get_component_capabilities');
		expect(names).toContain('get_notebook_app_grammar');
		expect(names).toContain('plan_notebook_app');
		expect(names).toContain('repair_notebook_blueprint');
		expect(names).toContain('score_notebook_blueprint');
		expect(names).toContain('inspect_resource');
		expect(names).toContain('discover_schema');
		expect(names).toContain('validate_workflow');
		expect(names).toContain('run_workflow');
		expect(names).toContain('delete_resource');
		expect(names).toContain('render_notebook_screenshot');
	});

	it('gates render_notebook_screenshot behind shares:publish', async () => {
		const action = listAgentActions().find((a) => a.name === 'render_notebook_screenshot');
		expect(action?.permission).toBe('shares:publish');
		expect(action?.mutates).toBe(true);

		const result = await executeAgentAction(
			'render_notebook_screenshot',
			{ notebookId: 'models/x' },
			viewerAuth
		);
		expect(result.ok).toBe(false);
		expect(result.diagnostics[0]?.code).toBe('FORBIDDEN');
	});

	it('returns the standard envelope for capabilities', async () => {
		const result = await executeAgentAction('list_capabilities', {}, adminAuth);
		expect(result.ok).toBe(true);
		expect(result.diagnostics).toEqual([]);
		expect(result.meta.action).toBe('list_capabilities');
		expect(result.data).toMatchObject({
			resourceRefs: expect.any(Array),
			componentCapabilities: {
				action: 'get_component_capabilities',
				aiAuthorableComponents: expect.arrayContaining(['metric', 'chart', 'filter'])
			},
			notebookAppGrammar: {
				action: 'get_notebook_app_grammar',
				mutationTools: expect.arrayContaining(['create_notebook', 'apply_notebook_patch'])
			},
			visualReportGrammar: {
				action: 'get_visual_report_grammar',
				blockTypes: expect.arrayContaining(['metric', 'chart', 'columns']),
				dataRoles: expect.arrayContaining([expect.objectContaining({ name: 'headline_fact' })]),
				styleAxes: expect.arrayContaining([expect.objectContaining({ name: 'density' })])
			}
		});
	});

	it('returns component capabilities and generic notebook app grammar', async () => {
		const capabilities = await executeAgentAction('get_component_capabilities', {}, adminAuth);
		expect(capabilities.ok).toBe(true);
		expect(capabilities.data).toMatchObject({
			version: expect.stringMatching(/^component-capabilities\.v1\./),
			aiAuthorableComponentIds: expect.arrayContaining(['chart', 'datatable', 'filter'])
		});

		const grammar = await executeAgentAction('get_notebook_app_grammar', {}, adminAuth);
		expect(grammar.ok).toBe(true);
		expect(grammar.data).toMatchObject({
			compileTarget: 'notebook',
			mutationTools: expect.arrayContaining(['create_notebook', 'apply_notebook_patch']),
			failSoftDiagnostics: expect.arrayContaining(['repairable', 'downgradable', 'fatal'])
		});
	});

	it('plans and repairs notebook app blueprints through read-only helper actions', async () => {
		const plan = await executeAgentAction(
			'plan_notebook_app',
			{ prompt: 'Build a simulator with bounded filters, charts, tables, and Q&A lineage' },
			adminAuth
		);
		expect(plan.ok).toBe(true);
		expect(plan.data).toMatchObject({
			compileTarget: 'notebook',
			intent: {
				primaryWorkflow: 'simulate',
				componentIds: expect.arrayContaining(['chart', 'datatable', 'filter'])
			}
		});

		const repair = await executeAgentAction(
			'repair_notebook_blueprint',
			{
				blueprint: {
					blocks: [
						{
							type: 'grid',
							cols: 9,
							items: [{ type: 'chart', chartType: 'radar', data: '$rows.rows' }]
						}
					]
				}
			},
			adminAuth
		);
		expect(repair.ok).toBe(true);
		expect(
			(repair.data as { result: { repairLog: Array<{ action: string }> } }).result.repairLog
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ action: 'large grid item -> sibling block' })
			])
		);
	});

	it('returns visual report grammar for open-ended composition', async () => {
		const result = await executeAgentAction('get_visual_report_grammar', {}, adminAuth);
		expect(result.ok).toBe(true);
		expect(result.data).toMatchObject({
			blockTypes: expect.arrayContaining(['metric', 'chart', 'datatable', 'columns']),
			chartTypes: expect.arrayContaining(['pie', 'bar-horizontal', 'map']),
			iconNames: expect.arrayContaining(['TreePine', 'Droplets']),
			dataRoles: expect.arrayContaining([
				expect.objectContaining({ name: 'headline_fact' }),
				expect.objectContaining({ name: 'flow_or_dependency' }),
				expect.objectContaining({ name: 'qualitative_context' })
			]),
			styleAxes: expect.arrayContaining([
				expect.objectContaining({ name: 'density' }),
				expect.objectContaining({ name: 'hierarchy' })
			]),
			referenceDeconstruction: expect.arrayContaining([
				expect.stringContaining('Extract intent first')
			]),
			blueprintExamples: expect.arrayContaining([
				expect.objectContaining({ name: 'generic_stat_story' }),
				expect.objectContaining({ name: 'generic_map_impact' }),
				expect.objectContaining({ name: 'generic_scroll_report' })
			])
		});
	});

	it('denies actions when role/scope policy rejects them', async () => {
		const result = await executeAgentAction(
			'create_notebook',
			{ notebookId: 'models/x', blocks: [{ type: 'text', content: 'x' }] },
			viewerAuth
		);
		expect(result.ok).toBe(false);
		expect(result.diagnostics[0]?.code).toBe('FORBIDDEN');
	});

	it('dry-runs workflow steps and reports per-step envelopes', async () => {
		const result = await executeAgentAction(
			'validate_workflow',
			{
				steps: [
					{
						id: 'make',
						action: 'create_notebook',
						input: {
							folder: '/tmp/project',
							notebookId: 'models/x',
							blocks: [{ type: 'text', content: 'x' }]
						}
					}
				]
			},
			adminAuth
		);
		expect(result.ok).toBe(true);
		const steps = (result.data as { steps: Array<{ result: { meta: { dryRun?: boolean } } }> })
			.steps;
		expect(steps[0]?.result.meta.dryRun).toBe(true);
	});

	it('replays idempotent mutating dry-run results by key', async () => {
		const first = await executeAgentAction('run_workflow', { steps: [] }, adminAuth, {
			dryRun: true,
			idempotencyKey: 'same-key'
		});
		const second = await executeAgentAction('run_workflow', { steps: [] }, adminAuth, {
			dryRun: true,
			idempotencyKey: 'same-key'
		});
		expect(first.ok).toBe(true);
		expect(second.meta.idempotencyReplay).toBe(true);
	});
});
