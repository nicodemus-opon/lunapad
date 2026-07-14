import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Connection } from '$lib/types/connection';

const { getConnectionMetadataMock, getSecretMock, fetchExternalConnectionSchemaMock } = vi.hoisted(
	() => ({
		getConnectionMetadataMock: vi.fn(),
		getSecretMock: vi.fn(),
		fetchExternalConnectionSchemaMock: vi.fn()
	})
);

vi.mock('./connections-store.js', () => ({ getConnectionMetadata: getConnectionMetadataMock }));
vi.mock('./connection-secrets.js', () => ({ getSecret: getSecretMock }));
vi.mock('./connections.js', () => ({
	queryExternalConnection: vi.fn(),
	fetchExternalConnectionSchema: fetchExternalConnectionSchemaMock
}));

import {
	createNotebookFromBlueprintOnDisk,
	patchNotebookOnDisk,
	validateNotebookOnDisk,
	inspectNotebookOnDisk,
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
		expect(written).toContain('connection="pg_main"');
		expect(written).toContain('Monthly Summary');
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
