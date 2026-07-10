import { describe, it, expect } from 'vitest';
import {
	classifyDashboardToolResult,
	initialDashboardLoopState,
	reduceDashboardTurn,
	dashboardDone
} from './dashboard-loop-signals.js';

// These literals mirror the exact return strings of executeToolCallWithResult /
// executeReadTool in ai-chat-client.ts — if a handler's wording changes, these tests
// must fail so the loop's progress detection is updated in lockstep.

describe('classifyDashboardToolResult', () => {
	it('recognizes create_notebook success', () => {
		expect(
			classifyDashboardToolResult(
				"Notebook 'Sales Overview' created (id: nb_123) with 3 executable cell(s)"
			)
		).toBe('notebook-created');
	});

	it('recognizes apply_notebook_patch success', () => {
		expect(classifyDashboardToolResult("Notebook 'Sales Overview' patched and validated")).toBe(
			'notebook-patched'
		);
	});

	it('recognizes blueprint rejections from both tools', () => {
		const rejections = [
			'create_notebook: draft validation failed; repair these diagnostics and call create_notebook again: blocks[0]: unknown ref',
			'create_notebook: failed to create notebook from validated draft',
			'apply_notebook_patch: notebook not found',
			'apply_notebook_patch: blueprint validation failed; repair these diagnostics: x',
			'apply_notebook_patch: patch validation failed; repair these diagnostics: x',
			'apply_notebook_patch: document validation failed; repair these diagnostics: x',
			'apply_notebook_patch: provide blueprint, document, or operations'
		];
		for (const r of rejections) {
			expect(classifyDashboardToolResult(r)).toBe('blueprint-rejected');
		}
	});

	it('recognizes legacy-tool blocks, wrapped and unwrapped', () => {
		expect(
			classifyDashboardToolResult(
				'create_cell/update_cell blocked: Legacy cell tools are disabled. Use inspect_notebook, apply_notebook_patch, run_query_nodes, and validate_notebook.'
			)
		).toBe('legacy-blocked');
		expect(
			classifyDashboardToolResult('Legacy cell tools are disabled. Use inspect_notebook…')
		).toBe('legacy-blocked');
	});

	it('recognizes validate_notebook JSON verdicts', () => {
		expect(
			classifyDashboardToolResult(JSON.stringify({ ok: true, notebookId: 'nb_1' }, null, 2))
		).toBe('validation-ok');
		expect(
			classifyDashboardToolResult(
				JSON.stringify({ ok: false, diagnostics: ['x'], missingCells: [] }, null, 2)
			)
		).toBe('validation-failed');
	});

	it('does not treat inspect_notebook JSON (no ok field) as a validation verdict', () => {
		expect(
			classifyDashboardToolResult(
				JSON.stringify({ notebookId: 'nb_1', name: 'x', document: {}, executableCells: [] }, null, 2)
			)
		).toBe('other');
	});

	it('recognizes data inspection results', () => {
		expect(classifyDashboardToolResult("get_cell_result('sales'): 12 rows")).toBe('inspection');
		expect(classifyDashboardToolResult('run_cells result:\nsales: OK (12 rows)')).toBe(
			'inspection'
		);
	});

	it('classifies unrelated results as other', () => {
		expect(classifyDashboardToolResult("Cell 'sales' created")).toBe('other');
		expect(classifyDashboardToolResult('not json {')).toBe('other');
	});
});

describe('reduceDashboardTurn', () => {
	const created = "Notebook 'X' created (id: nb_1) with 1 executable cell(s)";
	const rejected = 'create_notebook: draft validation failed; repair these diagnostics: x';
	const blocked = 'create_cell/update_cell blocked: Legacy cell tools are disabled.';

	it('counts consecutive rejection turns and resets on progress', () => {
		let s = initialDashboardLoopState();
		s = reduceDashboardTurn(s, [rejected]);
		s = reduceDashboardTurn(s, [rejected]);
		expect(s.rejectedTurns).toBe(2);
		expect(s.lastRejection).toBe(rejected);
		expect(s.notebookReady).toBe(false);
		// rejection mixed with progress in the same turn is convergence, not thrash
		s = reduceDashboardTurn(s, [rejected, created]);
		expect(s.rejectedTurns).toBe(0);
		expect(s.notebookReady).toBe(true);
		expect(s.notebookLabel).toBe('X');
	});

	it('counts legacy-blocked turns separately and resets on progress', () => {
		let s = initialDashboardLoopState();
		s = reduceDashboardTurn(s, [blocked]);
		s = reduceDashboardTurn(s, [blocked]);
		expect(s.legacyBlockedTurns).toBe(2);
		s = reduceDashboardTurn(s, [created]);
		expect(s.legacyBlockedTurns).toBe(0);
	});

	it('does not increment counters on neutral turns', () => {
		let s = initialDashboardLoopState();
		s = reduceDashboardTurn(s, [rejected]);
		s = reduceDashboardTurn(s, ["get_cell_result('sales'): 12 rows"]);
		expect(s.rejectedTurns).toBe(1);
		expect(s.inspectedResult).toBe(true);
	});

	it('sets validationFailed on ok:false and clears it on ok:true or a new patch', () => {
		const failed = JSON.stringify({ ok: false, diagnostics: ['x'], missingCells: [] });
		const passed = JSON.stringify({ ok: true, notebookId: 'nb_1' });
		let s = initialDashboardLoopState();
		s = reduceDashboardTurn(s, [created, failed]);
		expect(s.validationFailed).toBe(true);
		s = reduceDashboardTurn(s, [passed]);
		expect(s.validationFailed).toBe(false);
		s = reduceDashboardTurn(s, [failed]);
		s = reduceDashboardTurn(s, ["Notebook 'X' patched and validated"]);
		expect(s.validationFailed).toBe(false);
	});
});

describe('dashboardDone', () => {
	const created = "Notebook 'X' created (id: nb_1) with 1 executable cell(s)";
	const inspected = 'run_cells result:\nsales: OK';

	it('requires done signal, a ready notebook, inspection, and no failing validation', () => {
		let s = initialDashboardLoopState();
		expect(dashboardDone(s, true)).toBe(false); // nothing happened yet
		s = reduceDashboardTurn(s, [created]);
		expect(dashboardDone(s, true)).toBe(false); // never inspected data
		s = reduceDashboardTurn(s, [inspected]);
		expect(dashboardDone(s, false)).toBe(false); // no <done> yet
		expect(dashboardDone(s, true)).toBe(true);
	});

	it('blocks done while validation is failing', () => {
		let s = initialDashboardLoopState();
		s = reduceDashboardTurn(s, [created, inspected]);
		s = reduceDashboardTurn(s, [JSON.stringify({ ok: false, diagnostics: [], missingCells: [] })]);
		expect(dashboardDone(s, true)).toBe(false);
	});

	it('passes when <done> arrives in a later turn with zero tool results', () => {
		let s = initialDashboardLoopState();
		s = reduceDashboardTurn(s, [created, inspected]);
		s = reduceDashboardTurn(s, []); // empty turn — state persists
		expect(dashboardDone(s, true)).toBe(true);
	});
});
