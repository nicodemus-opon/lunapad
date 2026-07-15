import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Connection } from '$lib/types/connection';

const { getConnectionMetadataMock, getSecretMock, fetchExternalConnectionSchemaMock, queryExternalConnectionMock } = vi.hoisted(
	() => ({
		getConnectionMetadataMock: vi.fn(),
		getSecretMock: vi.fn(),
		fetchExternalConnectionSchemaMock: vi.fn(),
		queryExternalConnectionMock: vi.fn()
	})
);

vi.mock('./connections-store.js', () => ({ getConnectionMetadata: getConnectionMetadataMock }));
vi.mock('./connection-secrets.js', () => ({ getSecret: getSecretMock }));
vi.mock('./connections.js', () => ({
	queryExternalConnection: queryExternalConnectionMock,
	fetchExternalConnectionSchema: fetchExternalConnectionSchemaMock
}));

import {
	createNotebookFromBlueprintOnDisk,
	patchNotebookOnDisk,
	validateNotebookOnDisk,
	inspectNotebookOnDisk,
	runNotebookCellsOnDisk,
	deleteNotebookOnDisk,
	pickChartHeuristic
} from './notebook-mutation.js';

const pgConnection: Connection = {
	id: 'pg_main',
	name: 'Primary Postgres',
	type: 'postgres',
	catalogName: 'primary_postgres',
	host: 'localhost',
	port: 5432,
	database: 'jobs',
	username: 'postgres',
	ssl: false
};

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-notebook-mutation-test-'));
	await fs.mkdir(path.join(dir, 'models'), { recursive: true });
	vi.clearAllMocks();
	getConnectionMetadataMock.mockImplementation(async (id: string) =>
		id === 'pg_main' ? pgConnection : undefined
	);
	getSecretMock.mockResolvedValue(null);
	fetchExternalConnectionSchemaMock.mockResolvedValue({
		tables: [{ name: 'orders', columns: [] }]
	});
	queryExternalConnectionMock.mockResolvedValue({ rows: [{ id: 1 }], columns: ['id'] });
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('createNotebookFromBlueprintOnDisk', () => {
	it('compiles a blueprint with a query cell + chart and writes a .luna file', async () => {
		const result = await createNotebookFromBlueprintOnDisk(dir, 'models/reporting/monthly', {
			title: 'Monthly Summary',
			executableCells: [
				{
					cellId: 'q1',
					outputName: 'monthly_revenue',
					cellType: 'query',
					language: 'sql',
					code: 'select * from orders',
					connectionId: 'pg_main'
				}
			],
			blocks: [
				{ type: 'queryBlock', cellId: 'q1' },
				{
					type: 'metric',
					value: '$monthly_revenue.revenue',
					label: 'Revenue'
				}
			]
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.notebook).toBeDefined();
		expect(result.notebook?.cells.length).toBeGreaterThan(0);

		const written = await fs.readFile(path.join(dir, 'models/reporting/monthly.luna'), 'utf-8');
		expect(written).toContain('{% query name="monthly_revenue"');
		const inspected = await inspectNotebookOnDisk(dir, 'models/reporting/monthly');
		const cell = inspected.cells.find((c) => c.outputName === 'monthly_revenue');
		expect(cell?.id).toBe('q1');
		expect(written).toContain('connection="pg_main"');
		expect(written).toContain('Monthly Summary');
	});

	it('rejects duplicate output names instead of silently deconflicting them', async () => {
		const result = await createNotebookFromBlueprintOnDisk(dir, 'models/dupes', {
			executableCells: [
				{
					cellId: 'q_a',
					outputName: 'same_output',
					code: 'select * from orders',
					language: 'sql',
					connectionId: 'pg_main'
				},
				{
					cellId: 'q_b',
					outputName: 'same_output',
					code: 'select * from orders',
					language: 'sql',
					connectionId: 'pg_main'
				}
			],
			blocks: [
				{ type: 'queryBlock', cellId: 'q_a' },
				{ type: 'queryBlock', cellId: 'q_b' }
			]
		});
		expect(result.notebook).toBeUndefined();
		expect(result.diagnostics[0]?.message).toMatch(/Duplicate outputName/);
	});

	it('refuses to overwrite an existing notebook and returns a repairable diagnostic', async () => {
		const blueprint = {
			blocks: [{ type: 'text' as const, content: 'hello' }]
		};
		const first = await createNotebookFromBlueprintOnDisk(dir, 'models/a', blueprint);
		expect(first.diagnostics).toEqual([]);

		const second = await createNotebookFromBlueprintOnDisk(dir, 'models/a', blueprint);
		expect(second.notebook).toBeUndefined();
		expect(second.diagnostics[0]?.message).toMatch(/already exists/i);
	});

	it('rejects a query cell referencing a table that is not in the connection schema', async () => {
		const result = await createNotebookFromBlueprintOnDisk(dir, 'models/b', {
			executableCells: [
				{
					cellId: 'q1',
					outputName: 'bad',
					code: 'select * from totally_made_up_table',
					language: 'sql',
					connectionId: 'pg_main'
				}
			],
			blocks: [{ type: 'queryBlock', cellId: 'q1' }]
		});
		expect(result.notebook).toBeUndefined();
		expect(result.diagnostics[0]?.message).toMatch(/totally_made_up_table/);
		await expect(fs.access(path.join(dir, 'models/b.luna'))).rejects.toThrow();
	});

	it('rejects an unresolvable connectionId with a clear diagnostic instead of failing open', async () => {
		const result = await createNotebookFromBlueprintOnDisk(dir, 'models/bad-conn', {
			executableCells: [
				{
					cellId: 'q1',
					outputName: 'x',
					code: 'select 1',
					language: 'sql',
					connectionId: 'does_not_exist'
				}
			],
			blocks: [{ type: 'queryBlock', cellId: 'q1' }]
		});
		expect(result.notebook).toBeUndefined();
		expect(result.diagnostics[0]?.message).toMatch(/unknown connection/i);
	});

	it('does not write anything when the blueprint fails to compile', async () => {
		const result = await createNotebookFromBlueprintOnDisk(dir, 'models/c', {
			blocks: [{ type: 'grid', items: 'not-an-array' } as never]
		});
		expect(result.notebook).toBeUndefined();
		expect(result.diagnostics.length).toBeGreaterThan(0);
		await expect(fs.access(path.join(dir, 'models/c.luna'))).rejects.toThrow();
	});
});

describe('patchNotebookOnDisk', () => {
	async function createBase() {
		await createNotebookFromBlueprintOnDisk(dir, 'models/base', {
			blocks: [{ type: 'text', content: 'hello' }]
		});
	}

	it('adds a new block via operations', async () => {
		await createBase();
		const inspected = await inspectNotebookOnDisk(dir, 'models/base');
		expect(inspected.document.content?.length).toBeGreaterThan(0);

		const result = await patchNotebookOnDisk(dir, 'models/base', {
			operations: [
				{
					op: 'insert_node',
					index: 0,
					node: {
						type: 'markdocWidget',
						attrs: {
							tagName: 'callout',
							attrsJson: JSON.stringify({ type: 'warning' }),
							selfClosing: false
						},
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }]
					}
				}
			]
		});
		expect(result.diagnostics).toEqual([]);
		const content = await fs.readFile(path.join(dir, 'models/base.luna'), 'utf-8');
		expect(content).toContain('callout');
	});

	it('renames the notebook file when patched with title only', async () => {
		await createBase();
		const result = await patchNotebookOnDisk(dir, 'models/base', { title: 'Renamed Notebook' });
		expect(result.diagnostics).toEqual([]);
		expect(result.notebook?.id).toBe('models/renamed_notebook');
		await expect(fs.access(path.join(dir, 'models/renamed_notebook.luna'))).resolves.toBeUndefined();
		await expect(fs.access(path.join(dir, 'models/base.luna'))).rejects.toThrow();
	});

	it('rejects patching a flat (non-.luna) notebook', async () => {
		await fs.writeFile(path.join(dir, 'models/flat_model.prql'), 'from x', 'utf-8');
		const result = await patchNotebookOnDisk(dir, 'models/flat_model', { title: 'x' });
		expect(result.notebook).toBeUndefined();
		expect(result.diagnostics[0]?.message).toMatch(/not a \.luna notebook/i);
	});
});

describe('validateNotebookOnDisk', () => {
	it('returns no diagnostics for a freshly created valid notebook', async () => {
		await createNotebookFromBlueprintOnDisk(dir, 'models/valid', {
			blocks: [{ type: 'text', content: 'hello world' }]
		});
		const diagnostics = await validateNotebookOnDisk(dir, 'models/valid');
		expect(diagnostics).toEqual([]);
	});
});

describe('runNotebookCellsOnDisk', () => {
	it('reports unresolved cell ids instead of returning an empty result set', async () => {
		await createNotebookFromBlueprintOnDisk(dir, 'models/run', {
			executableCells: [
				{
					cellId: 'q_keep',
					outputName: 'kept_output',
					code: 'select * from orders',
					language: 'sql',
					connectionId: 'pg_main'
				}
			],
			blocks: [{ type: 'queryBlock', cellId: 'q_keep' }]
		});
		const result = await runNotebookCellsOnDisk(dir, 'models/run', ['missing_cell'], {
			allowPython: false
		});
		expect(result.results).toEqual([]);
		expect(result.diagnostics[0]?.message).toMatch(/missing_cell/);
		expect(result.execution.validCellIds).toContain('q_keep');
	});

	it('returns execution metadata for query cells', async () => {
		await createNotebookFromBlueprintOnDisk(dir, 'models/run_meta', {
			executableCells: [
				{
					cellId: 'q_orders',
					outputName: 'orders_out',
					code: 'select * from orders',
					language: 'sql',
					connectionId: 'pg_main'
				}
			],
			blocks: [{ type: 'queryBlock', cellId: 'q_orders' }]
		});
		const result = await runNotebookCellsOnDisk(dir, 'models/run_meta', ['q_orders'], {
			allowPython: false
		});
		expect(result.diagnostics).toEqual([]);
		expect(result.results[0]?.cellId).toBe('q_orders');
		expect(result.results[0]?.outputRef).toBe('output:models/run_meta#orders_out');
		expect(result.results[0]?.rowCount).toBe(1);
		expect(result.results[0]?.runtimeSql).toMatch(/orders/i);
	});
});

describe('deleteNotebookOnDisk', () => {
	it('deletes .luna notebooks and rejects flat notebooks', async () => {
		await createNotebookFromBlueprintOnDisk(dir, 'models/delete_me', {
			blocks: [{ type: 'text', content: 'bye' }]
		});
		const deleted = await deleteNotebookOnDisk(dir, 'models/delete_me');
		expect(deleted.diagnostics).toEqual([]);
		await expect(fs.access(path.join(dir, 'models/delete_me.luna'))).rejects.toThrow();

		await fs.writeFile(path.join(dir, 'models/flat_model.sql'), 'select 1', 'utf-8');
		const flat = await deleteNotebookOnDisk(dir, 'models/flat_model');
		expect(flat.diagnostics[0]?.message).toMatch(/not a \.luna notebook/i);
	});
});

describe('pickChartHeuristic', () => {
	it('picks a line chart when a date-like column is present', () => {
		const config = pickChartHeuristic(
			[{ order_date: '2024-01-01', revenue: 100 }],
			['order_date', 'revenue']
		);
		expect(config?.chartType).toBe('line');
		expect(config?.xColumn).toBe('order_date');
	});

	it('picks a bar chart for categorical + numeric columns', () => {
		const config = pickChartHeuristic([{ region: 'west', revenue: 100 }], ['region', 'revenue']);
		expect(config?.chartType).toBe('bar');
	});

	it('returns null when there is no numeric column', () => {
		expect(pickChartHeuristic([{ name: 'a', label: 'b' }], ['name', 'label'])).toBeNull();
	});
});
