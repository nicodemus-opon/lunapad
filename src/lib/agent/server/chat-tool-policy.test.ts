import { describe, expect, it } from 'vitest';
import {
	isChatToolCallAllowed,
	blockedToolFallbackText,
	isNativeToolCallWellFormed
} from './chat-tool-policy.js';

const ctx = {
	schemaTableNames: new Set(['orders', 'region_targets']),
	cellOutputNames: new Set(['monthly_revenue']),
	latestUserMessage: 'delete all cells now'
};

describe('chat-tool-policy', () => {
	it('blocks bulk delete_cell', () => {
		expect(isChatToolCallAllowed('delete_cell', { cellId: 'all' }, ctx)).toBe(false);
		expect(isChatToolCallAllowed('delete_cell', { cellId: 'orders' }, ctx)).toBe(false);
	});

	it('blocks sample_data on unknown tables', () => {
		expect(
			isChatToolCallAllowed(
				'sample_data',
				{ table: 'unicorn_revenue' },
				{
					...ctx,
					latestUserMessage: 'show arr'
				}
			)
		).toBe(false);
	});

	it('allows sample_data on schema tables', () => {
		expect(
			isChatToolCallAllowed(
				'sample_data',
				{ table: 'orders' },
				{
					...ctx,
					latestUserMessage: 'show orders'
				}
			)
		).toBe(true);
	});

	it('returns fallback text for unknown table', () => {
		const msg = blockedToolFallbackText(
			'sample_data',
			{ table: 'unicorn_revenue' },
			{ ...ctx, latestUserMessage: 'x' },
			[{ name: 'orders', columns: ['region'] }]
		);
		expect(msg).toMatch(/unicorn_revenue/);
		expect(msg).toMatch(/orders/);
	});

	it('blocks create_cell referencing unknown tables', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'cohort_ltv',
					code: 'from ltv_facts\nderive x = churn_score'
				},
				{ ...ctx, latestUserMessage: 'build ltv' }
			)
		).toBe(false);
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'cohort_ltv',
					code: 'PRQL model referencing table ltv_facts with columns customer_ltv'
				},
				{ ...ctx, latestUserMessage: 'build ltv' }
			)
		).toBe(false);
	});

	it('allows create_cell on known schema tables', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'ent_monthly',
					code: 'SELECT region, SUM(quantity * unit_price) FROM orders GROUP BY 1'
				},
				{ ...ctx, latestUserMessage: 'build' }
			)
		).toBe(true);
	});

	it('allows markdown create_cell without code field', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'overview',
					cellType: 'markdown',
					markdown: '## Hi\n{% metric value=$orders.count label="N" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['orders']) }
			)
		).toBe(true);
	});

	it('accepts structured dashboard payloads once compiled markdown is present', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'overview',
					cellType: 'markdown',
					dashboard: {
						title: 'Notebook',
						blocks: [{ type: 'metric', value: '$orders.count', label: 'Orders' }]
					},
					markdown: '{% metric value=$orders.count label="Orders" /%}'
				},
				{ ...ctx, latestUserMessage: 'document notebook', cellOutputNames: new Set(['orders']) }
			)
		).toBe(true);
	});

	it('blocks markdown with phantom refs', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'bad',
					cellType: 'markdown',
					markdown: '{% metric value=$phantom.total label="x" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['orders']) }
			)
		).toBe(false);
	});

	it('blocks markdown with $cell placeholder and stg_ refs', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'bad',
					cellType: 'markdown',
					markdown: '{% metric value=$cell.total label="x" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['monthly_revenue']) }
			)
		).toBe(false);
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'bad',
					cellType: 'markdown',
					markdown: '{% chart data=$stg_orders.rows x="region" y="n" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['stg_orders']) }
			)
		).toBe(false);
	});

	it('allows real columns on a known cell whose columns were not sent', () => {
		expect(
			isChatToolCallAllowed(
				'create_cell',
				{
					outputName: 'summary',
					cellType: 'markdown',
					markdown:
						'{% metric value=$stats.distinct_companies label="Companies" /%}\n{% metric value=$stats.min_scraped_at label="Oldest" format="date" /%}'
				},
				{ ...ctx, latestUserMessage: 'dashboard', cellOutputNames: new Set(['stats']) }
			)
		).toBe(true);
	});

	it('blocks wrong columns when real columns are known, and names the real columns in the fallback', () => {
		const policyCtx = {
			...ctx,
			latestUserMessage: 'dashboard',
			cellOutputNames: new Set(['stats']),
			columnsByOutputName: new Map([['stats', ['total_rows', 'min_scraped_at']]])
		};
		const args = {
			outputName: 'summary',
			cellType: 'markdown',
			markdown: '{% metric value=$stats.distinct_companies label="Companies" /%}'
		};
		expect(isChatToolCallAllowed('create_cell', args, policyCtx)).toBe(false);
		const msg = blockedToolFallbackText('create_cell', args, policyCtx, []);
		expect(msg).toMatch(/distinct_companies/);
		expect(msg).toMatch(/total_rows, min_scraped_at/);
	});
});

describe('isNativeToolCallWellFormed: apply_notebook_patch', () => {
	// Regression: the well-formedness gate only accepted blueprint/document/operations,
	// so a legitimate title-only rename call — {"title": "..."} with none of those set,
	// which ai-chat-client.ts's apply_notebook_patch handler explicitly supports via its
	// `if (!document) { if (notebookTitle?.trim()) { renameNotebook(...) } }` branch — was
	// silently rejected as "not well-formed" before it ever reached the client. The server
	// then reported "Model returned an empty response" even though the model had emitted a
	// perfectly valid tool call. Confirmed live: replaying the exact request body against
	// the raw NVIDIA API returned a clean apply_notebook_patch({title:"Test123"}) call.
	it('accepts a title-only rename with no blueprint/document/operations', () => {
		expect(isNativeToolCallWellFormed('apply_notebook_patch', { title: 'Test123' })).toBe(true);
	});

	it('still accepts a blueprint-based patch', () => {
		expect(
			isNativeToolCallWellFormed('apply_notebook_patch', {
				blueprint: { blocks: [{ type: 'queryBlock', cellId: 'x' }] }
			})
		).toBe(true);
	});

	it('still accepts a document-based patch', () => {
		expect(
			isNativeToolCallWellFormed('apply_notebook_patch', { document: { type: 'doc', content: [] } })
		).toBe(true);
	});

	it('still accepts an operations-based patch', () => {
		expect(
			isNativeToolCallWellFormed('apply_notebook_patch', { operations: [{ op: 'noop' }] })
		).toBe(true);
	});

	it('still rejects a call with none of title/blueprint/document/operations', () => {
		expect(isNativeToolCallWellFormed('apply_notebook_patch', { notebookId: 'nb1' })).toBe(false);
	});

	it('rejects a blank/whitespace-only title with nothing else set', () => {
		expect(isNativeToolCallWellFormed('apply_notebook_patch', { title: '   ' })).toBe(false);
	});

	// Regression: observed live from a real model (meta/llama-3.1-70b-instruct via NVIDIA) —
	// it sent {"notebookId": "rev-nb-A", "executableCells": [...]} with no wrapping blueprint.
	// Previously this was silently rejected as "not well-formed", surfacing the same generic
	// "empty response" error. It should instead reach the handler, which returns the specific
	// "provide blueprint, document, operations, or title" diagnostic the retry loop is already
	// built to catch (see dashboard-loop-signals.ts's TERMINAL_TOOL_ERROR_RE).
	it('accepts a standalone non-empty executableCells array (routes to the handler for a real diagnostic)', () => {
		expect(
			isNativeToolCallWellFormed('apply_notebook_patch', {
				notebookId: 'rev-nb-A',
				executableCells: [{ cellId: 'x', outputName: 'x', cellType: 'query', code: 'select 1' }]
			})
		).toBe(true);
	});

	it('rejects an empty executableCells array with nothing else set', () => {
		expect(
			isNativeToolCallWellFormed('apply_notebook_patch', { notebookId: 'rev-nb-A', executableCells: [] })
		).toBe(false);
	});
});

describe('isNativeToolCallWellFormed: run_query_nodes / run_cells empty-args fallbacks', () => {
	// Regression: both handlers explicitly support calling with no cellIds/nodeIds at all —
	// run_query_nodes falls back to every queryBlock cellId in the document (see
	// queryBlockCellIdsFromDocument: undefined nodeIds → no filter → everything), and
	// run_cells falls back to every ghost cell created this generation. The well-formedness
	// gate required a non-empty array for both, so a model correctly calling either tool
	// with no args (a normal, common pattern right after apply_notebook_patch) had its call
	// silently dropped and got the generic "Model returned an empty response" instead of
	// the tool actually running.
	it('run_query_nodes accepts empty/missing args', () => {
		expect(isNativeToolCallWellFormed('run_query_nodes', {})).toBe(true);
		expect(isNativeToolCallWellFormed('run_query_nodes', { cellIds: [] })).toBe(true);
		expect(isNativeToolCallWellFormed('run_query_nodes', { nodeIds: [] })).toBe(true);
	});

	it('run_query_nodes still accepts explicit cellIds/nodeIds', () => {
		expect(isNativeToolCallWellFormed('run_query_nodes', { cellIds: ['x'] })).toBe(true);
		expect(isNativeToolCallWellFormed('run_query_nodes', { nodeIds: ['n1'] })).toBe(true);
	});

	it('run_cells accepts empty/missing args', () => {
		expect(isNativeToolCallWellFormed('run_cells', {})).toBe(true);
		expect(isNativeToolCallWellFormed('run_cells', { cellIds: [] })).toBe(true);
	});

	it('run_cells still accepts explicit cellIds', () => {
		expect(isNativeToolCallWellFormed('run_cells', { cellIds: ['x'] })).toBe(true);
	});
});
