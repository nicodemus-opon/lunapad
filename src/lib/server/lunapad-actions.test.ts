import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '$lib/types/connection';

const {
	listConnectionsMetadataMock,
	getConnectionMetadataMock,
	getSecretMock,
	queryExternalConnectionMock,
	walkProjectDirectoryMock,
	getCurrentFolderMock,
	spawnDbtMock,
	getJobMock,
	precompileProjectModelsMock,
	collectProjectModelNamesMock,
	loadManifestMock,
	compileMock
} = vi.hoisted(() => ({
	listConnectionsMetadataMock: vi.fn(),
	getConnectionMetadataMock: vi.fn(),
	getSecretMock: vi.fn(),
	queryExternalConnectionMock: vi.fn(),
	walkProjectDirectoryMock: vi.fn(),
	getCurrentFolderMock: vi.fn(),
	spawnDbtMock: vi.fn(),
	getJobMock: vi.fn(),
	precompileProjectModelsMock: vi.fn(),
	collectProjectModelNamesMock: vi.fn(),
	loadManifestMock: vi.fn(),
	compileMock: vi.fn()
}));

vi.mock('./connections-store.js', () => ({
	listConnectionsMetadata: listConnectionsMetadataMock,
	getConnectionMetadata: getConnectionMetadataMock
}));
vi.mock('./connection-secrets.js', () => ({ getSecret: getSecretMock }));
vi.mock('./connections.js', () => ({ queryExternalConnection: queryExternalConnectionMock }));
vi.mock('./project.js', () => ({
	assertAllowedProjectFolder: vi.fn(),
	walkProjectDirectory: walkProjectDirectoryMock
}));
vi.mock('./dbt-schedules.js', () => ({ getCurrentFolder: getCurrentFolderMock }));
vi.mock('./dbt-runner.js', () => ({ spawnDbt: spawnDbtMock, getJob: getJobMock }));
vi.mock('./prql-compiler.js', () => ({
	precompileProjectModels: precompileProjectModelsMock,
	collectProjectModelNames: collectProjectModelNamesMock
}));
vi.mock('./dbt.js', () => ({ loadManifest: loadManifestMock }));
vi.mock('prqlc/dist/node/prqlc_js', () => ({
	compile: compileMock,
	CompileOptions: class {
		target = '';
		signature_comment = true;
	}
}));

import {
	listConnectionsAction,
	runQueryAction,
	runPrqlAction,
	listNotebooksAction,
	getNotebookAction,
	dbtRunAction,
	dbtCompileAction,
	getDbtJobStatusAction,
	getDbtManifestAction
} from './lunapad-actions';

const pgConnection: Connection = {
	id: 'pg-main',
	name: 'Primary Postgres',
	type: 'postgres',
	catalogName: 'primary_postgres',
	host: 'localhost',
	port: 5432,
	database: 'jobs',
	username: 'postgres',
	ssl: false
};

const duckdbConnection: Connection = {
	id: 'builtin.duckdb',
	name: 'DuckDB',
	type: 'duckdb-wasm',
	builtin: true
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('listConnectionsAction', () => {
	it('returns metadata from the store', async () => {
		listConnectionsMetadataMock.mockResolvedValueOnce([pgConnection]);
		expect(await listConnectionsAction()).toEqual({ connections: [pgConnection] });
	});
});

describe('runQueryAction', () => {
	it('looks up connection + secret then queries', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(pgConnection);
		getSecretMock.mockResolvedValueOnce({ password: 'pw' });
		queryExternalConnectionMock.mockResolvedValueOnce({ rows: [{ id: 1 }], columns: ['id'] });

		const result = await runQueryAction({ connectionId: 'pg-main', sql: 'SELECT id FROM t' });

		expect(result).toEqual({ rows: [{ id: 1 }], columns: ['id'] });
		expect(queryExternalConnectionMock).toHaveBeenCalledWith(
			pgConnection,
			{ password: 'pw' },
			'SELECT id FROM t'
		);
	});

	it('throws a clear error for an unknown connection id', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(null);
		await expect(runQueryAction({ connectionId: 'nope', sql: 'SELECT 1' })).rejects.toThrow(
			'Unknown connection id'
		);
		expect(queryExternalConnectionMock).not.toHaveBeenCalled();
	});

	it('rejects duckdb-wasm connections with a clear message, not a crash', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(duckdbConnection);
		await expect(
			runQueryAction({ connectionId: 'builtin.duckdb', sql: 'SELECT 1' })
		).rejects.toThrow('runs in-browser only');
		expect(queryExternalConnectionMock).not.toHaveBeenCalled();
	});
});

describe('runPrqlAction', () => {
	it('compiles PRQL to SQL targeting trino, then queries', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(pgConnection);
		getSecretMock.mockResolvedValueOnce(undefined);
		compileMock.mockReturnValueOnce('SELECT * FROM jobs');
		queryExternalConnectionMock.mockResolvedValueOnce({ rows: [], columns: [] });

		await runPrqlAction({ connectionId: 'pg-main', prql: 'from jobs' });

		expect(compileMock).toHaveBeenCalledWith(
			'from jobs',
			expect.objectContaining({ target: 'sql.trino' })
		);
		expect(queryExternalConnectionMock).toHaveBeenCalledWith(
			pgConnection,
			undefined,
			'SELECT * FROM jobs'
		);
	});

	it('wraps a PRQL compile error clearly', async () => {
		getConnectionMetadataMock.mockResolvedValueOnce(pgConnection);
		compileMock.mockImplementationOnce(() => {
			throw new Error('bad syntax');
		});
		await expect(runPrqlAction({ connectionId: 'pg-main', prql: 'not prql' })).rejects.toThrow(
			'PRQL compile error'
		);
	});
});

describe('folder resolution', () => {
	it('prefers the explicit folder param over getCurrentFolder', async () => {
		walkProjectDirectoryMock.mockResolvedValueOnce({ notebooks: [], folders: [] });
		await listNotebooksAction({ folder: '/explicit/path' });
		expect(walkProjectDirectoryMock).toHaveBeenCalledWith('/explicit/path');
		expect(getCurrentFolderMock).not.toHaveBeenCalled();
	});

	it('falls back to getCurrentFolder when no folder param is given', async () => {
		getCurrentFolderMock.mockReturnValueOnce('/current/path');
		walkProjectDirectoryMock.mockResolvedValueOnce({ notebooks: [], folders: [] });
		await listNotebooksAction({});
		expect(walkProjectDirectoryMock).toHaveBeenCalledWith('/current/path');
	});

	it('throws clearly when neither is available', async () => {
		getCurrentFolderMock.mockReturnValueOnce(null);
		await expect(listNotebooksAction({})).rejects.toThrow('No project folder specified');
	});
});

describe('listNotebooksAction / getNotebookAction', () => {
	it('summarizes notebooks with cell counts', async () => {
		walkProjectDirectoryMock.mockResolvedValueOnce({
			notebooks: [
				{ id: 'models/a', name: 'a', folderId: null, cells: [{}, {}], defaultCellLanguage: 'sql' }
			],
			folders: []
		});
		const result = await listNotebooksAction({ folder: '/p' });
		expect(result.notebooks).toEqual([{ id: 'models/a', name: 'a', folderId: null, cellCount: 2 }]);
	});

	it('getNotebookAction returns the full notebook by id', async () => {
		const notebook = {
			id: 'models/a',
			name: 'a',
			folderId: null,
			cells: [],
			defaultCellLanguage: 'sql'
		};
		walkProjectDirectoryMock.mockResolvedValueOnce({ notebooks: [notebook], folders: [] });
		const result = await getNotebookAction({ folder: '/p', notebookId: 'models/a' });
		expect(result.notebook).toEqual(notebook);
	});

	it('getNotebookAction throws for an unknown notebook id', async () => {
		walkProjectDirectoryMock.mockResolvedValueOnce({ notebooks: [], folders: [] });
		await expect(getNotebookAction({ folder: '/p', notebookId: 'nope' })).rejects.toThrow(
			'not found'
		);
	});
});

describe('dbtRunAction / dbtCompileAction', () => {
	it('precompiles PRQL models then spawns dbt run with --select', async () => {
		collectProjectModelNamesMock.mockResolvedValueOnce(['a', 'b']);
		spawnDbtMock.mockReturnValueOnce('job-1');
		const result = await dbtRunAction({ folder: '/p', select: 'a' });
		expect(precompileProjectModelsMock).toHaveBeenCalledWith('/p', ['a', 'b']);
		expect(spawnDbtMock).toHaveBeenCalledWith(['run', '--select', 'a'], '/p');
		expect(result).toEqual({ jobId: 'job-1' });
	});

	it('spawns dbt compile with no --select', async () => {
		collectProjectModelNamesMock.mockResolvedValueOnce([]);
		spawnDbtMock.mockReturnValueOnce('job-2');
		await dbtCompileAction({ folder: '/p' });
		expect(spawnDbtMock).toHaveBeenCalledWith(['compile'], '/p');
	});
});

describe('getDbtJobStatusAction', () => {
	it('returns job status', async () => {
		getJobMock.mockReturnValueOnce({ done: true, exitCode: 0, lines: ['ok'] });
		expect(await getDbtJobStatusAction({ jobId: 'job-1' })).toEqual({
			done: true,
			exitCode: 0,
			lines: ['ok']
		});
	});

	it('throws for an unknown job id', async () => {
		getJobMock.mockReturnValueOnce(undefined);
		await expect(getDbtJobStatusAction({ jobId: 'nope' })).rejects.toThrow(
			'Unknown or expired job'
		);
	});
});

describe('getDbtManifestAction', () => {
	it('returns models from the manifest', async () => {
		loadManifestMock.mockResolvedValueOnce([{ name: 'orders' }]);
		expect(await getDbtManifestAction({ folder: '/p' })).toEqual({ models: [{ name: 'orders' }] });
	});
});
