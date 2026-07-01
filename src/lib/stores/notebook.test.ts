import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordCellExecutionMetadataMock, recordUploadedTableMetadataMock } = vi.hoisted(() => ({
	recordCellExecutionMetadataMock: vi.fn(),
	recordUploadedTableMetadataMock: vi.fn()
}));

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: recordCellExecutionMetadataMock,
	recordUploadedTableMetadata: recordUploadedTableMetadataMock,
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

import {
	__resetStateForTests,
	addCell,
	addNotebook,
	getConnections,
	addNotebookInFolder,
	addMarkdownCell,
	closeNotebookTab,
	createFolder,
	deleteFolderIfEmpty,
	deleteNotebook,
	duplicateCell,
	getCells,
	getFolders,
	getNotebooks,
	getOpenNotebookTabIds,
	getOpenResultTabs,
	getRunImpact,
	isFolderEmpty,
	openNotebookTab,
	openResultTab,
	importJSON,
	exportJSON,
	setCellConnection,
	setNotebookConnection,
	setCellMaterializeMode,
	setCellMaterializeTarget,
	setCellScheduleEnabled,
	setCellScheduleIntervalMinutes,
	setCellScheduleScope,
	upsertConnection,
	updateCellName,
	updateGuiStages,
	updateCellMarkdown,
	updateCellCode,
	getAllCellsAcrossNotebooks,
	getNotebookFilterValue,
	setNotebookFilterValue,
	getNotebookAutoRefresh,
	setNotebookAutoRefresh
} from '$lib/stores/notebook.svelte';

describe('notebook store', () => {
	beforeEach(() => {
		__resetStateForTests();
		recordCellExecutionMetadataMock.mockReset();
		recordUploadedTableMetadataMock.mockReset();
	});

	it('closes notebook tab without deleting notebook', () => {
		addNotebook();
		const notebooks = getNotebooks();
		expect(notebooks).toHaveLength(2);

		const secondId = notebooks[1].id;
		closeNotebookTab(secondId);

		expect(getNotebooks()).toHaveLength(2);
		expect(getOpenNotebookTabIds()).not.toContain(secondId);
	});

	it('deleting notebook removes its result tabs', () => {
		addNotebook();
		const notebooks = getNotebooks();
		const second = notebooks[1];
		const firstCellId = second.cells[0].id;

		openResultTab(firstCellId, second.id, 'result2');
		expect(getOpenResultTabs().some((t) => t.notebookId === second.id)).toBe(true);

		deleteNotebook(second.id);
		expect(getOpenResultTabs().some((t) => t.notebookId === second.id)).toBe(false);
	});

	it('getAllCellsAcrossNotebooks returns cells from every notebook', () => {
		const notebookA = getNotebooks()[0];
		addNotebook();
		const notebookB = getNotebooks()[1];
		updateCellCode(notebookB.cells[0].id, 'select 1 as x');

		const all = getAllCellsAcrossNotebooks();
		expect(all.some((c) => c.id === notebookA.cells[0].id)).toBe(true);
		expect(all.some((c) => c.id === notebookB.cells[0].id)).toBe(true);
	});

	it('stores and retrieves a notebook-scoped filter value', () => {
		const nb = getNotebooks()[0];
		expect(getNotebookFilterValue(nb.id, 'region')).toBe('');
		setNotebookFilterValue(nb.id, 'region', 'EU');
		expect(getNotebookFilterValue(nb.id, 'region')).toBe('EU');
	});

	it('filter values are scoped per notebook', () => {
		const notebookA = getNotebooks()[0];
		addNotebook();
		const notebookB = getNotebooks()[1];
		setNotebookFilterValue(notebookA.id, 'region', 'EU');
		expect(getNotebookFilterValue(notebookB.id, 'region')).toBe('');
	});

	describe('updateCellName', () => {
		it('renames to a unique name', () => {
			const cellId = getCells()[0].id;
			const result = updateCellName(cellId, 'totally_unique_name');
			expect(result).toEqual({ ok: true });
			expect(getCells().find((c) => c.id === cellId)?.outputName).toBe('totally_unique_name');
		});

		it('rejects a rename that collides with a cell in another notebook', () => {
			const notebookA = getNotebooks()[0];
			const cellA = notebookA.cells[0];
			updateCellName(cellA.id, 'shared_name');

			addNotebook();
			const notebookB = getNotebooks()[1];
			const cellB = notebookB.cells[0];

			const result = updateCellName(cellB.id, 'shared_name');
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toMatch(/already used/i);
			// Rejected rename must not mutate the cell.
			expect(getCells().find((c) => c.id === cellB.id)?.outputName).not.toBe('shared_name');
		});
	});

	it('duplicateCell deconflicts against the whole project, not just the active notebook', () => {
		const notebookA = getNotebooks()[0];
		updateCellName(notebookA.cells[0].id, 'metrics');

		addNotebook(); // also switches the active tab to the new notebook
		const notebookB = getNotebooks()[1];
		updateCellName(notebookB.cells[0].id, 'metrics_copy');

		// Switch back to notebook A and duplicate "metrics". The naive suffix
		// would be "metrics_copy" — but that name is already taken in notebook B,
		// so a project-wide check must skip to "metrics_copy2".
		openNotebookTab(notebookA.id);
		const clonedId = duplicateCell(notebookA.cells[0].id);
		const clone = getNotebooks()
			.flatMap((n) => n.cells)
			.find((c) => c.id === clonedId);
		expect(clone?.outputName).toBe('metrics_copy2');
	});

	it('stores and retrieves the auto-refresh interval', () => {
		const nb = getNotebooks()[0];
		expect(getNotebookAutoRefresh(nb.id)).toBe(0);
		setNotebookAutoRefresh(nb.id, 30000);
		expect(getNotebookAutoRefresh(nb.id)).toBe(30000);
		// Clear the timer so it doesn't keep running past this test.
		setNotebookAutoRefresh(nb.id, 0);
		expect(getNotebookAutoRefresh(nb.id)).toBe(0);
	});

	it('blocks deleting a non-empty folder', () => {
		const folderId = createFolder('Reports');
		addNotebookInFolder(folderId);

		expect(isFolderEmpty(folderId)).toBe(false);
		expect(deleteFolderIfEmpty(folderId)).toBe(false);
		expect(getFolders().some((f) => f.id === folderId)).toBe(true);
	});

	it('deletes an empty folder', () => {
		const folderId = createFolder('Archive');
		expect(isFolderEmpty(folderId)).toBe(true);
		expect(deleteFolderIfEmpty(folderId)).toBe(true);
		expect(getFolders().some((f) => f.id === folderId)).toBe(false);
	});

	it('migrates legacy saved state without folder metadata', () => {
		importJSON(
			JSON.stringify({
				notebooks: [
					{
						id: 'nb-legacy',
						name: 'Legacy Notebook',
						cells: [
							{
								id: 'cell-1',
								outputName: 'result1',
								code: 'from table1'
							}
						]
					}
				],
				activeTabId: 'nb-legacy',
				openResultTabs: [],
				tables: [],
				theme: 'system'
			})
		);

		expect(getNotebooks()).toHaveLength(1);
		expect(getNotebooks()[0].folderId).toBeNull();
		expect(getOpenNotebookTabIds()).toEqual(['nb-legacy']);
		expect(getFolders()).toEqual([]);
		expect(getCells()[0].connectionId).toBeNull();
		expect(getConnections()[0].type).toBe('duckdb-wasm');
	});

	it('exports connection metadata without persisting secrets', () => {
		// Secrets live server-side (encrypted, keyed by connection id) and are never
		// part of client state at all, so there's nothing for exportJSON to leak.
		const cellId = getCells()[0].id;
		upsertConnection({
			id: 'pg-main',
			name: 'Primary Postgres',
			type: 'postgres',
			catalogName: 'test_postgres',
			host: 'localhost',
			port: 5432,
			database: 'analytics',
			username: 'nico',
			ssl: false
		});
		setCellConnection(cellId, 'pg-main');

		const snapshot = exportJSON();

		expect(snapshot).toContain('Primary Postgres');
		expect(snapshot).toContain('"connectionId":"pg-main"');
		expect(snapshot).not.toMatch(/password|secret/i);
	});

	describe('connection sanitization for new connector types', () => {
		function roundTrip(connection: Parameters<typeof upsertConnection>[0]) {
			upsertConnection(connection);
			const snapshot = exportJSON();
			__resetStateForTests();
			importJSON(snapshot);
			return getConnections().find((c) => c.id === connection.id);
		}

		it('round-trips a MariaDB connection', () => {
			const restored = roundTrip({
				id: 'maria-1',
				name: 'MariaDB',
				type: 'mariadb',
				catalogName: 'maria_main',
				host: 'localhost',
				port: 3306,
				database: 'mydb',
				username: 'root',
				ssl: true
			});
			expect(restored).toMatchObject({
				type: 'mariadb',
				host: 'localhost',
				port: 3306,
				database: 'mydb',
				ssl: true
			});
		});

		it('round-trips a Redshift connection', () => {
			const restored = roundTrip({
				id: 'rs-1',
				name: 'Redshift',
				type: 'redshift',
				catalogName: 'rs_main',
				host: 'redshift.example.com',
				port: 5439,
				database: 'dev',
				username: 'awsuser',
				ssl: true
			});
			expect(restored).toMatchObject({ type: 'redshift', database: 'dev' });
		});

		it('round-trips a SingleStore connection', () => {
			const restored = roundTrip({
				id: 'ss-1',
				name: 'SingleStore',
				type: 'singlestore',
				catalogName: 'ss_main',
				host: 'localhost',
				port: 3306,
				database: 'mydb',
				username: 'root',
				ssl: false
			});
			expect(restored).toMatchObject({ type: 'singlestore', port: 3306 });
		});

		it('round-trips a MongoDB connection', () => {
			const restored = roundTrip({
				id: 'mongo-1',
				name: 'Mongo',
				type: 'mongodb',
				catalogName: 'mongo_main',
				host: 'localhost',
				port: 27017,
				database: 'mydb',
				username: 'appuser',
				ssl: false
			});
			expect(restored).toMatchObject({ type: 'mongodb', port: 27017 });
		});

		it('round-trips an Elasticsearch connection without a username', () => {
			const restored = roundTrip({
				id: 'es-1',
				name: 'ES',
				type: 'elasticsearch',
				catalogName: 'es_main',
				host: 'es.example.com',
				port: 9200,
				database: 'default'
			});
			expect(restored).toMatchObject({ type: 'elasticsearch', database: 'default' });
			expect((restored as { username?: string })?.username).toBeUndefined();
		});

		it('round-trips a SQL Server connection with encrypt/trustServerCertificate', () => {
			const restored = roundTrip({
				id: 'mssql-1',
				name: 'SQL Server',
				type: 'sqlserver',
				catalogName: 'mssql_main',
				host: 'sql.example.com',
				port: 1433,
				database: 'master',
				username: 'sa',
				encrypt: true,
				trustServerCertificate: true
			});
			expect(restored).toMatchObject({
				type: 'sqlserver',
				encrypt: true,
				trustServerCertificate: true
			});
		});

		it('round-trips an Oracle connection (no database field)', () => {
			const restored = roundTrip({
				id: 'ora-1',
				name: 'Oracle',
				type: 'oracle',
				catalogName: 'ora_main',
				host: 'ora.example.com',
				port: 1521,
				username: 'system',
				identifierType: 'service_name',
				serviceName: 'ORCLPDB1'
			});
			expect(restored).toMatchObject({
				type: 'oracle',
				identifierType: 'service_name',
				serviceName: 'ORCLPDB1'
			});
			expect(restored && 'database' in restored).toBe(false);
		});

		it('round-trips a Snowflake connection (no host/port)', () => {
			const restored = roundTrip({
				id: 'sf-1',
				name: 'Snowflake',
				type: 'snowflake',
				catalogName: 'sf_main',
				account: 'xy12345.us-east-1',
				warehouse: 'COMPUTE_WH',
				database: 'MYDB',
				username: 'svc_user',
				role: 'ANALYST'
			});
			expect(restored).toMatchObject({
				type: 'snowflake',
				account: 'xy12345.us-east-1',
				warehouse: 'COMPUTE_WH',
				role: 'ANALYST'
			});
			expect(restored && 'host' in restored).toBe(false);
		});

		it('round-trips a Cassandra connection with contact points and local datacenter', () => {
			const restored = roundTrip({
				id: 'cass-1',
				name: 'Cassandra',
				type: 'cassandra',
				catalogName: 'cass_main',
				contactPoints: '10.0.0.1,10.0.0.2',
				port: 9042,
				localDatacenter: 'datacenter1'
			});
			expect(restored).toMatchObject({
				type: 'cassandra',
				contactPoints: '10.0.0.1,10.0.0.2',
				localDatacenter: 'datacenter1'
			});
		});

		it('round-trips a Google Sheets connection (metadata sheet ID only)', () => {
			const restored = roundTrip({
				id: 'gs-1',
				name: 'Sheets',
				type: 'gsheets',
				catalogName: 'gs_main',
				metadataSheetId: 'sheet123'
			});
			expect(restored).toMatchObject({ type: 'gsheets', metadataSheetId: 'sheet123' });
		});

		it('round-trips a BigQuery connection with a parent project', () => {
			const restored = roundTrip({
				id: 'bq-1',
				name: 'BigQuery',
				type: 'bigquery',
				catalogName: 'bq_main',
				projectId: 'my-gcp-project',
				parentProjectId: 'billing-project'
			});
			expect(restored).toMatchObject({
				type: 'bigquery',
				projectId: 'my-gcp-project',
				parentProjectId: 'billing-project'
			});
			expect(restored && 'host' in restored).toBe(false);
		});

		it('round-trips a BigQuery connection without a parent project', () => {
			const restored = roundTrip({
				id: 'bq-2',
				name: 'BigQuery',
				type: 'bigquery',
				catalogName: 'bq_noparent',
				projectId: 'my-gcp-project'
			});
			expect(restored).toMatchObject({ type: 'bigquery', projectId: 'my-gcp-project' });
			expect((restored as { parentProjectId?: string })?.parentProjectId).toBeUndefined();
		});

		it('drops a BigQuery entry missing the required projectId field', () => {
			importJSON(
				JSON.stringify({
					notebooks: getNotebooks(),
					activeTabId: getNotebooks()[0].id,
					openResultTabs: [],
					tables: [],
					theme: 'system',
					connections: [
						{ id: 'bq-bad', name: 'Bad BigQuery', type: 'bigquery', catalogName: 'bq_bad' }
						// missing `projectId`
					]
				})
			);
			expect(getConnections().some((c) => c.id === 'bq-bad')).toBe(false);
		});

		it('drops a Snowflake entry missing the required warehouse field', () => {
			importJSON(
				JSON.stringify({
					notebooks: getNotebooks(),
					activeTabId: getNotebooks()[0].id,
					openResultTabs: [],
					tables: [],
					theme: 'system',
					connections: [
						{
							id: 'sf-bad',
							name: 'Bad Snowflake',
							type: 'snowflake',
							catalogName: 'sf_bad',
							account: 'xy12345',
							database: 'MYDB',
							username: 'svc_user'
							// missing `warehouse`
						}
					]
				})
			);
			expect(getConnections().some((c) => c.id === 'sf-bad')).toBe(false);
		});
	});

	it('applies a notebook-level connection to all query cells only', () => {
		upsertConnection({
			id: 'pg-main',
			name: 'Primary Postgres',
			type: 'postgres',
			catalogName: 'test_postgres',
			host: 'localhost',
			port: 5432,
			database: 'analytics',
			username: 'nico',
			ssl: false
		});

		addMarkdownCell();
		addCell();
		const notebooks = getNotebooks();
		const notebook = notebooks[0];

		setNotebookConnection(notebook.id, 'pg-main');

		expect(
			notebook.cells
				.filter((cell) => cell.cellType === 'query')
				.every((cell) => cell.connectionId === 'pg-main')
		).toBe(true);
		expect(notebook.cells.find((cell) => cell.cellType === 'markdown')?.connectionId).toBeNull();
	});

	it('initializes materialization defaults for new cells', () => {
		const cell = getCells()[0];
		expect(cell.materializeMode).toBe('table');
		expect(cell.materializeStatus).toBe('idle');
		expect(cell.materializeError).toBeNull();
		expect(cell.materializeTarget).toBe(cell.outputName);
	});

	it('updates materialization mode and target for a cell', () => {
		const cellId = getCells()[0].id;
		setCellMaterializeMode(cellId, 'view');
		setCellMaterializeTarget(cellId, 'orders_mart');

		const updated = getCells().find((c) => c.id === cellId)!;
		expect(updated.materializeMode).toBe('view');
		expect(updated.materializeTarget).toBe('orders_mart');
	});

	it('initializes scheduling defaults for new cells', () => {
		const cell = getCells()[0];
		expect(cell.scheduleEnabled).toBe(false);
		expect(cell.scheduleIntervalMinutes).toBe(60);
		expect(cell.scheduleScope).toBe('cell');
		expect(cell.scheduleNextRunAt).toBeNull();
		expect(cell.scheduleLastError).toBeNull();
	});

	it('updates cell scheduling configuration', () => {
		const cellId = getCells()[0].id;
		setCellScheduleEnabled(cellId, true);
		setCellScheduleIntervalMinutes(cellId, 15);
		setCellScheduleScope(cellId, 'segment');

		const updated = getCells().find((c) => c.id === cellId)!;
		expect(updated.scheduleEnabled).toBe(true);
		expect(updated.scheduleIntervalMinutes).toBe(15);
		expect(updated.scheduleScope).toBe('segment');
		expect(updated.scheduleNextRunAt).not.toBeNull();
	});

	it('persists scheduling configuration through export/import', () => {
		const cellId = getCells()[0].id;
		setCellScheduleEnabled(cellId, true);
		setCellScheduleIntervalMinutes(cellId, 30);
		setCellScheduleScope(cellId, 'segment');

		const snapshot = exportJSON();
		__resetStateForTests();
		importJSON(snapshot);

		const restored = getCells()[0];
		expect(restored.scheduleEnabled).toBe(true);
		expect(restored.scheduleIntervalMinutes).toBe(30);
		expect(restored.scheduleScope).toBe('segment');
	});

	it('updates gui stages immediately and compiles after debounce', async () => {
		vi.useFakeTimers();
		try {
			// New cells default to SQL; GUI stages compile through the PRQL path.
			getCells()[0].language = 'prql';
			const cellId = getCells()[0].id;
			updateGuiStages(cellId, [
				{ type: 'from', table: 'orders' },
				{ type: 'take', n: 10 }
			]);

			const cellNow = getCells().find((c) => c.id === cellId)!;
			expect(cellNow.guiStages).toHaveLength(2);
			expect(cellNow.code).toContain('take 10');
			expect(cellNow.compiledSQL).toBeNull();

			await vi.advanceTimersByTimeAsync(130);

			const cellLater = getCells().find((c) => c.id === cellId)!;
			expect(cellLater.compiledSQL !== null || cellLater.errors.length > 0).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('adds markdown cell as non-query cell', () => {
		addMarkdownCell();
		const cells = getCells();
		const last = cells[cells.length - 1];
		expect(last.cellType).toBe('markdown');
		expect(last.markdown).toBe('');
		expect(last.markdownPreview).toBe(false);
	});

	it('persists markdown content through export/import', () => {
		addMarkdownCell();
		const markdownCell = getCells()[getCells().length - 1];
		updateCellMarkdown(markdownCell.id, '# Hello\n\n- item');

		const snapshot = exportJSON();
		__resetStateForTests();
		importJSON(snapshot);

		const restored = getCells().find((c) => c.id === markdownCell.id);
		expect(restored).toBeDefined();
		expect(restored!.cellType).toBe('markdown');
		expect(restored!.markdown).toBe('# Hello\n\n- item');
	});

	it('computes downstream run impact within same connection segment', () => {
		const first = getCells()[0];
		updateCellCode(first.id, 'from orders');
		addCell();
		addMarkdownCell();
		addCell();

		const cells = getCells();
		const second = cells[1];
		const third = cells[3];
		updateCellCode(second.id, 'filter amount > 0');
		updateCellCode(third.id, 'take 10');

		expect(getRunImpact(first.id)).toEqual({ segmentCount: 3, downstreamCount: 2 });
		expect(getRunImpact(second.id)).toEqual({ segmentCount: 2, downstreamCount: 1 });
		expect(getRunImpact(third.id)).toEqual({ segmentCount: 1, downstreamCount: 0 });
	});

	it('stops run impact at connection boundaries', () => {
		upsertConnection({
			id: 'pg-main',
			name: 'Primary Postgres',
			type: 'postgres',
			catalogName: 'test_postgres',
			host: 'localhost',
			port: 5432,
			database: 'analytics',
			username: 'nico',
			ssl: false
		});

		const first = getCells()[0];
		updateCellCode(first.id, 'from orders');
		addCell();
		const second = getCells()[1];
		updateCellCode(second.id, 'select {id}');
		setCellConnection(second.id, 'pg-main');

		expect(getRunImpact(first.id)).toEqual({ segmentCount: 1, downstreamCount: 0 });
		expect(getRunImpact(second.id)).toEqual({ segmentCount: 1, downstreamCount: 0 });
	});

	it('stops run impact at next from stage in same connection', () => {
		const first = getCells()[0];
		updateCellCode(first.id, 'from orders');
		addCell();
		addCell();

		const cells = getCells();
		const second = cells[1];
		const third = cells[2];
		updateCellCode(second.id, 'filter amount > 100');
		updateCellCode(third.id, 'from customers');

		expect(getRunImpact(first.id)).toEqual({ segmentCount: 2, downstreamCount: 1 });
		expect(getRunImpact(third.id)).toEqual({ segmentCount: 1, downstreamCount: 0 });
	});
});
