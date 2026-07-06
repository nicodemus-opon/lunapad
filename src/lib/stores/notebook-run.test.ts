import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	compilePRQLMock,
	createViewMock,
	dropTableMock,
	dropViewMock,
	executeSQLMock,
	queryConnectionSQLMock,
	materializeConnectionRelationMock,
	setPrevViewMock,
	registerPythonResultTableMock,
	clearPythonResultTableMock,
	listMainSchemaRelationsMock,
	uploadConnectionTableMock,
	runPythonMock,
	watchPythonLogsMock,
	cancelPythonMock,
	isPythonEnvReadyMock
} = vi.hoisted(() => ({
	compilePRQLMock: vi.fn(),
	createViewMock: vi.fn(),
	dropTableMock: vi.fn(),
	dropViewMock: vi.fn(),
	executeSQLMock: vi.fn(),
	queryConnectionSQLMock: vi.fn(),
	materializeConnectionRelationMock: vi.fn(),
	setPrevViewMock: vi.fn(),
	registerPythonResultTableMock: vi.fn(),
	clearPythonResultTableMock: vi.fn(),
	listMainSchemaRelationsMock: vi.fn(),
	uploadConnectionTableMock: vi.fn(),
	runPythonMock: vi.fn(),
	watchPythonLogsMock: vi.fn(),
	cancelPythonMock: vi.fn(),
	isPythonEnvReadyMock: vi.fn()
}));

const { recordCellExecutionMetadataMock, recordUploadedTableMetadataMock } = vi.hoisted(() => ({
	recordCellExecutionMetadataMock: vi.fn(),
	recordUploadedTableMetadataMock: vi.fn()
}));

vi.mock('$lib/services/prql', () => ({
	compilePRQL: compilePRQLMock
}));

vi.mock('$lib/services/duckdb', () => ({
	createView: createViewMock,
	dropTable: dropTableMock,
	dropView: dropViewMock,
	executeSQL: executeSQLMock,
	setPrevView: setPrevViewMock,
	registerPythonResultTable: registerPythonResultTableMock,
	clearPythonResultTable: clearPythonResultTableMock,
	listMainSchemaRelations: listMainSchemaRelationsMock
}));

vi.mock('$lib/services/connections', () => ({
	queryConnectionSQL: queryConnectionSQLMock,
	materializeConnectionRelation: materializeConnectionRelationMock,
	uploadConnectionTable: uploadConnectionTableMock,
	syncConnectionMetadata: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/services/python-client', () => ({
	runPython: runPythonMock,
	watchPythonLogs: watchPythonLogsMock,
	cancelPython: cancelPythonMock,
	isPythonEnvReady: isPythonEnvReadyMock
}));

vi.mock('$lib/services/intelligence-db', () => ({
	recordCellExecutionMetadata: recordCellExecutionMetadataMock,
	recordUploadedTableMetadata: recordUploadedTableMetadataMock,
	getIntelligentQuickChips: vi.fn().mockResolvedValue([])
}));

import {
	__resetStateForTests,
	AUTO_LIMIT,
	wrapWithAutoLimit,
	addCell,
	addNotebook,
	getNotebookEvents,
	getNotebooks,
	getPythonTableHints,
	materializeCell,
	runCell,
	runPythonCell,
	setCellConnection,
	setExternalConnectionSchema,
	upsertConnection
} from '$lib/stores/notebook.svelte';
import type { Cell } from '$lib/stores/notebook.svelte';

function autoLimitSql(inner: string): string {
	return `SELECT _lunapad_sub.*, COUNT(*) OVER () AS __lunapad_total_rows FROM (${inner}) AS _lunapad_sub LIMIT ${AUTO_LIMIT + 1}`;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('notebook cell execution', () => {
	beforeEach(() => {
		__resetStateForTests();
		compilePRQLMock.mockReset();
		createViewMock.mockReset();
		dropTableMock.mockReset();
		dropViewMock.mockReset();
		executeSQLMock.mockReset();
		recordCellExecutionMetadataMock.mockReset();
		recordUploadedTableMetadataMock.mockReset();
		queryConnectionSQLMock.mockReset();
		materializeConnectionRelationMock.mockReset();
		setPrevViewMock.mockReset();
		registerPythonResultTableMock.mockReset();
		clearPythonResultTableMock.mockReset();
		listMainSchemaRelationsMock.mockReset();
		uploadConnectionTableMock.mockReset();
		runPythonMock.mockReset();
		watchPythonLogsMock.mockReset();
		cancelPythonMock.mockReset();
		isPythonEnvReadyMock.mockReset();

		compilePRQLMock.mockReturnValue({
			sql: 'SELECT * FROM employees',
			errors: []
		});
		createViewMock.mockResolvedValue(undefined);
		dropTableMock.mockResolvedValue(undefined);
		dropViewMock.mockResolvedValue(undefined);
		queryConnectionSQLMock.mockResolvedValue({ rows: [], columns: [] });
		materializeConnectionRelationMock.mockResolvedValue({ name: 'employees_mart', type: 'table' });
		setPrevViewMock.mockResolvedValue(undefined);
		registerPythonResultTableMock.mockResolvedValue(undefined);
		clearPythonResultTableMock.mockResolvedValue(undefined);
		listMainSchemaRelationsMock.mockResolvedValue([]);
		uploadConnectionTableMock.mockResolvedValue({ rowsInserted: 1 });
		runPythonMock.mockResolvedValue('py-job-1');
		isPythonEnvReadyMock.mockResolvedValue(true);
		watchPythonLogsMock.mockImplementation((_jobId, _onLine, onDone) => {
			onDone(0, {
				error: null,
				figures: [],
				dataframe: { rows: [{ id: 1 }], columns: ['id'] }
			});
			return () => {};
		});

		// New cells default to SQL; these tests exercise the PRQL compile path.
		getNotebooks()[0].cells[0].language = 'prql';
	});

	it('keeps the previous result mounted while a rerun is in flight', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		cell.status = 'success';
		cell.compiledSQL = 'SELECT * FROM employees';
		cell.result = {
			rows: [{ name: 'Ada' }],
			columns: ['name']
		};

		const pendingQuery = deferred<{ rows: Record<string, unknown>[]; columns: string[] }>();
		executeSQLMock.mockReturnValue(pendingQuery.promise);

		const runPromise = runCell(cell.id);

		expect(cell.status).toBe('running');
		expect(cell.compiledSQL).toBe('SELECT * FROM employees');
		expect(cell.result).toEqual({
			rows: [{ name: 'Ada' }],
			columns: ['name']
		});

		pendingQuery.resolve({
			rows: [{ name: 'Grace' }],
			columns: ['name']
		});

		await runPromise;

		expect(cell.status).toBe('success');
		expect(compilePRQLMock).toHaveBeenCalledWith('from employees', 'sql.duckdb');
		expect(cell.result).toEqual({
			rows: [{ name: 'Grace' }],
			columns: ['name'],
			totalRowCount: 1
		});
		expect(createViewMock).toHaveBeenCalledWith(
			cell.outputName || `_cell_${cell.id}`,
			'SELECT * FROM employees'
		);
	});

	it('records intelligence and event memory for built-in execution', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		executeSQLMock.mockResolvedValue({
			rows: [{ id: 1, name: 'Ada' }],
			columns: ['id', 'name']
		});

		await runCell(cell.id);

		expect(cell.intelligence).not.toBeNull();
		expect(cell.intelligence?.connectionId).toBe('builtin.duckdb');
		expect(cell.intelligence?.rowCount).toBe(1);
		expect(getNotebookEvents().at(-1)?.eventType).toBe('run-success');
		expect(getNotebookEvents().at(-1)?.connectionId).toBe('builtin.duckdb');
	});

	it('normalizes escaped quoted scalar values from built-in query results', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		executeSQLMock.mockResolvedValue({
			rows: [
				{
					amount: '\\"5300\\"',
					city: '\\"Nairobi\\"',
					label: '"Quarter 1"',
					nested: { score: '\\"99\\"' }
				}
			],
			columns: ['amount', 'city', 'label', 'nested']
		});

		await runCell(cell.id);

		expect(cell.result?.rows[0]).toEqual({
			amount: '5300',
			city: 'Nairobi',
			label: '"Quarter 1"',
			nested: { score: '99' }
		});
	});

	it('decodes hugeint-like aggregate wrappers into scalar values', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		executeSQLMock.mockResolvedValue({
			rows: [
				{ sum_rent_usd: { 0: 5300, 1: 0, 2: 0, 3: 0 } },
				{ sum_rent_usd: new Int32Array([4100, 0, 0, 0]) }
			],
			columns: ['sum_rent_usd']
		});

		await runCell(cell.id);

		expect(cell.result?.rows).toEqual([{ sum_rent_usd: 5300 }, { sum_rent_usd: 4100 }]);
	});

	it('dispatches postgres cells through the external query service', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
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
		setCellConnection(cell.id, 'pg-main');
		queryConnectionSQLMock.mockResolvedValue({
			rows: [{ name: 'Ada' }],
			columns: ['name']
		});

		await runCell(cell.id);

		expect(compilePRQLMock).toHaveBeenCalledWith('from employees', 'sql.trino');
		expect(queryConnectionSQLMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pg-main', type: 'postgres' }),
			autoLimitSql('SELECT * FROM employees'),
			expect.anything(), // AbortSignal
			expect.any(String) // runId
		);
		expect(executeSQLMock).not.toHaveBeenCalled();
		expect(setPrevViewMock).not.toHaveBeenCalled();
		expect(createViewMock).not.toHaveBeenCalled();
		expect(cell.status).toBe('success');
		expect(cell.intelligence?.connectionId).toBe('pg-main');
		expect(getNotebookEvents().at(-1)?.connectionId).toBe('pg-main');
	});

	it('normalizes escaped quoted scalar values from external query results', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
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
		setCellConnection(cell.id, 'pg-main');
		queryConnectionSQLMock.mockResolvedValue({
			rows: [{ amount: '\\"1200\\"', text: '\\"north\\"' }],
			columns: ['amount', 'text']
		});

		await runCell(cell.id);

		expect(cell.result?.rows[0]).toEqual({ amount: '1200', text: 'north' });
	});

	it('expands cross-cell references as let CTEs for DuckDB cells', async () => {
		// CTE expansion only applies to the built-in DuckDB connection.
		// External DB cells run their own code directly (no CTE injection).
		const notebook = getNotebooks()[0];
		notebook.cells[0].outputName = 'employees_raw';
		notebook.cells[0].code = 'from employees';
		addCell();
		addCell();

		const [, second, third] = notebook.cells;
		second.language = 'prql';
		third.language = 'prql';
		second.outputName = 'employees_named';
		second.code = 'from employees_raw\nselect {name}';
		// third (DuckDB) references second's outputName → gets CTE expansion
		third.code = 'from employees_named\nderive {upper_name = upper name}';
		// All cells on built-in DuckDB (no setCellConnection call)

		await runCell(third.id);

		expect(compilePRQLMock).toHaveBeenLastCalledWith(
			'let employees_raw = (\n  from employees\n)\n\nlet employees_named = (\n  from employees_raw\n  select {name}\n)\n\nfrom employees_named\nderive {upper_name = upper name}',
			'sql.duckdb'
		);
	});

	it('external DB cells CTE-expand upstream deps into a single compiled query', async () => {
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

		const notebook = getNotebooks()[0];
		notebook.cells[0].outputName = 'employees_raw';
		notebook.cells[0].code = 'from employees';
		notebook.cells[0].connectionId = 'pg-main';
		addCell();

		const [, second] = notebook.cells;
		second.language = 'prql';
		second.outputName = 'pg_result';
		second.code = 'from employees_raw\nfilter active = true';
		setCellConnection(second.id, 'pg-main');

		await runCell(second.id);

		// Postgres cells now use CTE expansion: upstream code is inlined as a let-binding
		expect(compilePRQLMock).toHaveBeenLastCalledWith(
			'let employees_raw = (\n  from employees\n)\n\nfrom employees_raw\nfilter active = true',
			'sql.trino'
		);
	});

	it('reuses compile output across repeated runs with the same code and target', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		executeSQLMock.mockResolvedValue({ rows: [], columns: [] });

		await runCell(cell.id);
		await runCell(cell.id);

		expect(compilePRQLMock).toHaveBeenCalledTimes(1);
		expect(compilePRQLMock).toHaveBeenCalledWith('from employees', 'sql.duckdb');
	});

	it('keeps compile cache scoped by SQL target', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';

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

		executeSQLMock.mockResolvedValue({ rows: [], columns: [] });
		queryConnectionSQLMock.mockResolvedValue({ rows: [], columns: [] });

		await runCell(cell.id);
		setCellConnection(cell.id, 'pg-main');
		await runCell(cell.id);

		expect(compilePRQLMock).toHaveBeenNthCalledWith(1, 'from employees', 'sql.duckdb');
		expect(compilePRQLMock).toHaveBeenNthCalledWith(2, 'from employees', 'sql.trino');
		expect(compilePRQLMock).toHaveBeenCalledTimes(2);
	});

	it('inherits target schema when materializing external relations', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';

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
		setCellConnection(cell.id, 'pg-main');
		setExternalConnectionSchema('pg-main', 'Primary Postgres', [
			{ name: 'orders', schema: 'analytics', columns: ['id'], columnTypes: ['int4'] }
		]);

		await materializeCell(cell.id);

		expect(materializeConnectionRelationMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pg-main', type: 'postgres' }),
			expect.any(String),
			'SELECT * FROM employees',
			'table',
			'analytics'
		);
	});

	it('caps results at AUTO_LIMIT and flags truncation, keeping the view unwrapped', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		executeSQLMock.mockResolvedValue({
			rows: Array.from({ length: AUTO_LIMIT + 1 }, (_, i) => ({
				id: i,
				__lunapad_total_rows: 5000
			})),
			columns: ['id', '__lunapad_total_rows']
		});

		await runCell(cell.id);

		expect(executeSQLMock).toHaveBeenCalledWith(autoLimitSql('SELECT * FROM employees'));
		expect(cell.result?.rows).toHaveLength(AUTO_LIMIT);
		expect(cell.result?.truncated).toBe(true);
		expect(cell.result?.totalRowCount).toBe(5000);
		expect(cell.compiledSQL).toBe('SELECT * FROM employees');
		expect(createViewMock).toHaveBeenCalledWith(expect.any(String), 'SELECT * FROM employees');
	});

	it('does not flag truncation when results fit within AUTO_LIMIT', async () => {
		const cell = getNotebooks()[0].cells[0];
		cell.code = 'from employees';
		executeSQLMock.mockResolvedValue({
			rows: [{ id: 1 }],
			columns: ['id']
		});

		await runCell(cell.id);

		expect(cell.result?.rows).toHaveLength(1);
		expect(cell.result?.truncated).toBeUndefined();
	});
});

describe('wrapWithAutoLimit', () => {
	it('wraps SELECT statements', () => {
		expect(wrapWithAutoLimit('SELECT * FROM t')).toEqual({
			sql: autoLimitSql('SELECT * FROM t'),
			wrapped: true
		});
	});

	it('wraps WITH statements', () => {
		expect(wrapWithAutoLimit('WITH a AS (SELECT 1) SELECT * FROM a').wrapped).toBe(true);
	});

	it('strips a trailing semicolon before wrapping', () => {
		expect(wrapWithAutoLimit('select 1;')).toEqual({
			sql: autoLimitSql('select 1'),
			wrapped: true
		});
	});

	it('leaves EXPLAIN and PRAGMA statements unwrapped', () => {
		expect(wrapWithAutoLimit('EXPLAIN SELECT 1')).toEqual({
			sql: 'EXPLAIN SELECT 1',
			wrapped: false
		});
		expect(wrapWithAutoLimit('PRAGMA table_info(t)').wrapped).toBe(false);
	});

	it('leaves multi-statement SQL unwrapped', () => {
		const sql = 'CREATE TABLE t (id INT); SELECT * FROM t';
		expect(wrapWithAutoLimit(sql)).toEqual({ sql, wrapped: false });
	});
});

function pythonCellFixture(): Cell {
	return {
		...getNotebooks()[0].cells[0],
		id: 'py-cell-1',
		cellType: 'python',
		outputName: 'py_sales',
		code: 'result = pd.DataFrame({"id": [1]})',
		status: 'idle',
		result: null,
		pythonOutput: null,
		errors: [],
		executionMs: null,
		compiledSQL: null,
		materializeStatus: 'idle',
		materializeError: null,
		materializedRelationType: null,
		needsRun: false,
		staleReason: null,
		staleSources: [],
		lastRunAt: null,
		executionCount: 0
	} as Cell;
}

describe('python cell execution', () => {
	beforeEach(() => {
		__resetStateForTests();
		uploadConnectionTableMock.mockReset();
		registerPythonResultTableMock.mockReset();
		runPythonMock.mockReset();
		watchPythonLogsMock.mockReset();
		isPythonEnvReadyMock.mockReset();
		uploadConnectionTableMock.mockResolvedValue({ rowsInserted: 1 });
		runPythonMock.mockResolvedValue('py-job-1');
		isPythonEnvReadyMock.mockResolvedValue(true);
		watchPythonLogsMock.mockImplementation((_jobId, _onLine, onDone) => {
			onDone(0, {
				error: null,
				figures: [],
				dataframe: { rows: [{ id: 1 }], columns: ['id'] }
			});
			return () => {};
		});
	});

	it('publishes successful python results to the notebook default external connection', async () => {
		upsertConnection({
			id: 'pg-main',
			name: 'Primary Postgres',
			type: 'postgres',
			catalogName: 'analytics',
			host: 'localhost',
			port: 5432,
			database: 'warehouse',
			username: 'nico',
			ssl: false
		});
		setCellConnection(getNotebooks()[0].cells[0].id, 'pg-main');
		getNotebooks()[0].cells.push(pythonCellFixture());

		await runPythonCell('py-cell-1');

		expect(uploadConnectionTableMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pg-main', type: 'postgres' }),
			'py_sales',
			[{ name: 'id', type: 'BIGINT' }],
			[[1]],
			'replace',
			'public'
		);
		expect(registerPythonResultTableMock).toHaveBeenCalledWith('py_sales', [{ id: 1 }], ['id']);
	});

	it('falls back to the local cache when the notebook has no external connection', async () => {
		getNotebooks()[0].cells.push(pythonCellFixture());

		await runPythonCell('py-cell-1');

		expect(uploadConnectionTableMock).not.toHaveBeenCalled();
		expect(registerPythonResultTableMock).toHaveBeenCalledWith('py_sales', [{ id: 1 }], ['id']);
	});

	it('scopes python table hints to the current notebook connections', async () => {
		upsertConnection({
			id: 'pg-main',
			name: 'Primary Postgres',
			type: 'postgres',
			catalogName: 'analytics',
			host: 'localhost',
			port: 5432,
			database: 'warehouse',
			username: 'nico',
			ssl: false
		});
		upsertConnection({
			id: 'mysql-main',
			name: 'Secondary MySQL',
			type: 'mysql',
			catalogName: 'ops',
			host: 'localhost',
			port: 3306,
			database: 'warehouse',
			username: 'nico',
			ssl: false
		});
		setCellConnection(getNotebooks()[0].cells[0].id, 'pg-main');
		setExternalConnectionSchema('pg-main', 'Primary Postgres', [
			{ name: 'orders', schema: 'public', columns: ['id'], columnTypes: ['BIGINT'] }
		]);
		setExternalConnectionSchema('mysql-main', 'Secondary MySQL', [
			{ name: 'tickets', schema: 'support', columns: ['id'], columnTypes: ['BIGINT'] }
		]);

		addNotebook();
		const secondNotebook = getNotebooks()[1]!;
		secondNotebook.cells[0].cellType = 'query';
		secondNotebook.cells[0].language = 'sql';
		setCellConnection(secondNotebook.cells[0].id, 'mysql-main');

		const hints = getPythonTableHints('tables["orders"]', getNotebooks()[0]!.id);

		expect(hints.some((hint) => hint.canonicalName === 'analytics.public.orders')).toBe(true);
		expect(hints.some((hint) => hint.canonicalName === 'ops.support.tickets')).toBe(false);
	});

	it('reads fully qualified external tables with the catalog intact', async () => {
		upsertConnection({
			id: 'pg-main',
			name: 'Primary Postgres',
			type: 'postgres',
			catalogName: 'analytics',
			host: 'localhost',
			port: 5432,
			database: 'warehouse',
			username: 'nico',
			ssl: false
		});
		setCellConnection(getNotebooks()[0].cells[0].id, 'pg-main');
		setExternalConnectionSchema('pg-main', 'Primary Postgres', [
			{
				name: 'orders',
				schema: 'public',
				columns: ['id'],
				columnTypes: ['BIGINT']
			}
		]);
		const pythonCell = pythonCellFixture();
		pythonCell.code = 'result = tables["analytics.public.orders"]';
		getNotebooks()[0].cells.push(pythonCell);

		await runPythonCell('py-cell-1');

		expect(queryConnectionSQLMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'pg-main', type: 'postgres' }),
			'SELECT * FROM "analytics"."public"."orders" LIMIT 1000'
		);
	});
});
