import { describe, expect, it } from 'vitest';
import { buildNotebookIntelligence, recommendNotebookActions } from '$lib/services/notebook-intelligence';

describe('notebook-intelligence actions', () => {
	it('recommends repair replacement actions from query repair hints', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from orders\nselect {ammount}',
			rows: [],
			columns: [],
			executionMs: null,
			errors: ['column "ammount" does not exist'],
			schemaTables: [
				{ name: 'orders', columns: ['amount', 'status'], columnTypes: ['DOUBLE', 'VARCHAR'] }
			]
		});

		const actions = recommendNotebookActions({
			code: 'from orders\nselect {ammount}',
			intelligence,
			runImpact: { segmentCount: 1, downstreamCount: 0 },
			isGuiMode: false,
			hasResult: false
		});

		expect(actions.some((action) => action.kind === 'apply-repair-replacement')).toBe(true);
		expect(actions.find((action) => action.kind === 'apply-repair-replacement')?.payload).toMatchObject({
			from: 'ammount',
			to: 'amount'
		});
	});

	it('recommends performance and segment actions for expensive runs', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from big_orders',
			rows: Array.from({ length: 3 }, (_, idx) => ({ amount: idx + 1, status: 'ok' })),
			columns: ['amount', 'status'],
			executionMs: 4500,
			errors: [],
			schemaTables: [{ name: 'big_orders', columns: ['amount', 'status'], columnTypes: ['DOUBLE', 'VARCHAR'] }]
		});
		intelligence.rowCount = 120000;

		const actions = recommendNotebookActions({
			code: 'from big_orders',
			intelligence,
			runImpact: { segmentCount: 4, downstreamCount: 3 },
			isGuiMode: true,
			hasResult: true
		});

		expect(actions.some((action) => action.kind === 'add-filter-stage')).toBe(true);
		expect(actions.some((action) => action.kind === 'add-take-stage')).toBe(true);
		expect(actions.some((action) => action.kind === 'materialize-cell')).toBe(true);
		expect(actions.some((action) => action.kind === 'run-cell-and-downstream')).toBe(true);
		expect(actions.some((action) => action.kind === 'set-schedule-segment')).toBe(true);
	});

	it('recommends join and branch actions in gui mode', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from orders',
			rows: [
				{ order_id: 1, customer_name: 'Ada', amount: 120, created_at: '2026-05-01' },
				{ order_id: 2, customer_name: 'Grace', amount: 220, created_at: '2026-05-02' }
			],
			columns: ['order_id', 'customer_name', 'amount', 'created_at'],
			executionMs: 120,
			errors: [],
			schemaTables: [
				{ name: 'orders', columns: ['customer_id', 'amount', 'created_at'], columnTypes: ['INT', 'DOUBLE', 'DATE'] },
				{ name: 'customers', columns: ['id', 'customer_name'], columnTypes: ['INT', 'VARCHAR'] }
			]
		});

		const actions = recommendNotebookActions({
			code: 'from orders',
			intelligence,
			runImpact: { segmentCount: 1, downstreamCount: 0 },
			isGuiMode: true,
			hasResult: true
		});

		expect(actions.some((action) => action.kind === 'insert-join-stage')).toBe(true);
		expect(actions.some((action) => action.kind === 'branch-top-contributors')).toBe(true);
		expect(actions.some((action) => action.kind === 'open-chart-recommended')).toBe(true);
	});

	it('recommends alias and cast repair actions from ambiguity and type hints', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from orders\nselect {amount}',
			rows: [],
			columns: [],
			executionMs: null,
			errors: ['ambiguous reference', 'type mismatch cannot cast implicitly'],
			schemaTables: [{ name: 'orders', columns: ['amount'], columnTypes: ['DOUBLE'] }]
		});

		const actions = recommendNotebookActions({
			code: 'from orders\nselect {amount}',
			intelligence,
			runImpact: { segmentCount: 1, downstreamCount: 0 },
			isGuiMode: false,
			hasResult: false
		});

		expect(actions.some((action) => action.kind === 'apply-repair-alias')).toBe(true);
		expect(actions.some((action) => action.kind === 'apply-repair-cast')).toBe(true);
	});

	it('recommends select-stage trim for wide schemas and applies feedback-aware ranking', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from very_wide_table',
			rows: [
				Object.fromEntries(Array.from({ length: 24 }, (_, idx) => [`col_${idx}`, idx]))
			],
			columns: Array.from({ length: 24 }, (_, idx) => `col_${idx}`),
			executionMs: 3000,
			errors: [],
			schemaTables: [
				{
					name: 'very_wide_table',
					columns: Array.from({ length: 24 }, (_, idx) => `col_${idx}`),
					columnTypes: Array.from({ length: 24 }, () => 'DOUBLE')
				}
			]
		});

		const actions = recommendNotebookActions({
			code: 'from very_wide_table',
			intelligence,
			runImpact: { segmentCount: 3, downstreamCount: 2 },
			isGuiMode: true,
			hasResult: true,
			feedback: {
				acceptedByActionId: { 'select:trim-wide-shape': 3 },
				dismissedByActionId: { 'chart:line': 4 }
			}
		});

		expect(actions.some((action) => action.kind === 'add-select-stage')).toBe(true);
		expect(actions.find((action) => action.id === 'select:trim-wide-shape')).toBeDefined();
	});

	it('suggests composed revenue analyses from price and quantity columns', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from wg',
			rows: [
				{ 'Item Name': 'A', Category: 'Snacks', 'Price (GHS)': 10, 'Units Sold': 2, 'Date Sold': '2026-01-01', Location: 'Accra', 'Customer Type': 'Walk-in' },
				{ 'Item Name': 'B', Category: 'Drinks', 'Price (GHS)': 12, 'Units Sold': 3, 'Date Sold': '2026-01-02', Location: 'Kumasi', 'Customer Type': 'Online' }
			],
			columns: ['Item Name', 'Category', 'Price (GHS)', 'Units Sold', 'Date Sold', 'Location', 'Customer Type'],
			executionMs: 140,
			errors: [],
			schemaTables: [{ name: 'wg', columns: ['Item Name', 'Category', 'Price (GHS)', 'Units Sold', 'Date Sold', 'Location', 'Customer Type'], columnTypes: ['VARCHAR', 'VARCHAR', 'DOUBLE', 'INTEGER', 'DATE', 'VARCHAR', 'VARCHAR'] }]
		});

		expect(intelligence.nextAnalyses.some((idea) => /derive .*Price \(GHS\).*Units Sold/i.test(idea))).toBe(true);
		expect(intelligence.nextAnalyses.some((idea) => /Revenue by Category/i.test(idea))).toBe(true);
	});

	it('branches top contributors using business dimensions before name-like columns', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from wg',
			rows: [
				{ 'Item Name': 'Chocolate Bar', Category: 'Snacks', Location: 'Accra', amount: 120 },
				{ 'Item Name': 'Juice', Category: 'Drinks', Location: 'Kumasi', amount: 90 }
			],
			columns: ['Item Name', 'Category', 'Location', 'amount'],
			executionMs: 120,
			errors: [],
			schemaTables: [{ name: 'wg', columns: ['Item Name', 'Category', 'Location', 'amount'], columnTypes: ['VARCHAR', 'VARCHAR', 'VARCHAR', 'DOUBLE'] }]
		});

		const actions = recommendNotebookActions({
			code: 'from wg',
			intelligence,
			runImpact: { segmentCount: 1, downstreamCount: 0 },
			isGuiMode: true,
			hasResult: true
		});

		const branch = actions.find((action) => action.kind === 'branch-top-contributors');
		expect(branch).toBeDefined();
		expect(typeof branch?.payload?.dimension).toBe('string');
		expect(String(branch?.payload?.dimension)).not.toMatch(/Item Name/i);
	});

	it('suggests net flow analysis when inflow and outflow columns exist', () => {
		const intelligence = buildNotebookIntelligence({
			connectionId: 'builtin.duckdb',
			code: 'from ledger',
			rows: [
				{ 'Date Sold': '2026-01-01', deposited: 200, withdrawn: 140, Category: 'A' },
				{ 'Date Sold': '2026-01-02', deposited: 180, withdrawn: 120, Category: 'B' }
			],
			columns: ['Date Sold', 'deposited', 'withdrawn', 'Category'],
			executionMs: 130,
			errors: [],
			schemaTables: [{ name: 'ledger', columns: ['Date Sold', 'deposited', 'withdrawn', 'Category'], columnTypes: ['DATE', 'DOUBLE', 'DOUBLE', 'VARCHAR'] }]
		});

		expect(intelligence.nextAnalyses.some((idea) => /net flow analysis/i.test(idea))).toBe(true);
	});
});
