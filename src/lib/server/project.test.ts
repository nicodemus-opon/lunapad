import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	applyManagedTrinoBlock,
	deleteCellFile,
	ensureManagedProfileDefaults,
	renameCellFile,
	scaffoldDbtProject,
	trinoConnectionDefaults,
	walkProjectDirectory
} from './project.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-project-test-'));
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await fs.rm(dir, { recursive: true, force: true });
});

async function write(relPath: string, content: string): Promise<void> {
	const abs = path.join(dir, relPath);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, content, 'utf-8');
}

describe('renameCellFile', () => {
	it('refuses to overwrite an existing destination file', async () => {
		await write('models/a.prql', 'from a');
		await write('models/b.prql', 'from b');

		await expect(
			renameCellFile(path.join(dir, 'models/a.prql'), path.join(dir, 'models/b.prql'))
		).rejects.toThrow(/already exists/i);

		// Both files must be untouched.
		expect(await fs.readFile(path.join(dir, 'models/a.prql'), 'utf-8')).toBe('from a');
		expect(await fs.readFile(path.join(dir, 'models/b.prql'), 'utf-8')).toBe('from b');
	});

	it('renames to a fresh path and moves the companion .sql file', async () => {
		await write('models/a.prql', 'from a');
		await write('models/a.sql', 'select * from a');

		await renameCellFile(path.join(dir, 'models/a.prql'), path.join(dir, 'models/c.prql'));

		expect(await fs.readFile(path.join(dir, 'models/c.prql'), 'utf-8')).toBe('from a');
		expect(await fs.readFile(path.join(dir, 'models/c.sql'), 'utf-8')).toBe('select * from a');
		await expect(fs.access(path.join(dir, 'models/a.prql'))).rejects.toThrow();
	});
});

describe('deleteCellFile', () => {
	it('unlinks the file from disk (not just in-memory state)', async () => {
		await write('models/a.prql', 'from a');
		const abs = path.join(dir, 'models/a.prql');
		expect(await fs.readFile(abs, 'utf-8')).toBe('from a');

		await deleteCellFile(abs);

		await expect(fs.access(abs)).rejects.toThrow();
	});

	it('deletes the companion .sql file alongside a .prql source', async () => {
		await write('models/a.prql', 'from a');
		await write('models/a.sql', 'select * from a');

		await deleteCellFile(path.join(dir, 'models/a.prql'));

		await expect(fs.access(path.join(dir, 'models/a.prql'))).rejects.toThrow();
		await expect(fs.access(path.join(dir, 'models/a.sql'))).rejects.toThrow();
	});

	it('removes the parent directory once it is left empty', async () => {
		await write('models/sub/a.prql', 'from a');

		await deleteCellFile(path.join(dir, 'models/sub/a.prql'));

		await expect(fs.access(path.join(dir, 'models/sub'))).rejects.toThrow();
	});

	it('leaves the parent directory when a sibling file remains', async () => {
		await write('models/sub/a.prql', 'from a');
		await write('models/sub/b.prql', 'from b');

		await deleteCellFile(path.join(dir, 'models/sub/a.prql'));

		expect(await fs.readFile(path.join(dir, 'models/sub/b.prql'), 'utf-8')).toBe('from b');
	});
});

describe('walkProjectDirectory', () => {
	it('deconflicts two standalone files with the same name in different folders', async () => {
		await write('models/x/transform.prql', 'from x');
		await write('models/y/transform.prql', 'from y');

		const { notebooks } = await walkProjectDirectory(dir);
		const cells = notebooks.flatMap((n) => n.cells);
		const names = cells.map((c) => c.outputName).sort();

		expect(names).toEqual(['transform', 'transform_copy']);
		// id must follow outputName for file-backed cells, and stay unique.
		const ids = new Set(cells.map((c) => c.id));
		expect(ids.size).toBe(cells.length);
	});

	it('deconflicts two query entries with the same name inside one .luna notebook', async () => {
		await write(
			'notebooks/report.luna',
			[
				'{% query name="metrics" lang="prql" %}',
				'from a',
				'{% /query %}',
				'{% query name="metrics" lang="prql" %}',
				'from b',
				'{% /query %}'
			].join('\n')
		);

		const { notebooks } = await walkProjectDirectory(dir);
		const reportNb = notebooks.find((n) => n.id === 'notebooks/report');
		expect(reportNb).toBeDefined();
		const names = reportNb!.cells.map((c) => c.outputName);
		expect(names).toEqual(['metrics', 'metrics_copy']);
		// Regression: both entries derived id "metrics" from the shared name,
		// which crashed lineage with each_key_duplicate. Ids must be unique.
		const ids = new Set(reportNb!.cells.map((c) => c.id));
		expect(ids.size).toBe(reportNb!.cells.length);
	});

	it('keeps cell ids unique when a .luna entry collides with a file-backed model', async () => {
		await write('models/orders.prql', 'from raw_orders');
		await write(
			'notebooks/report.luna',
			['{% query name="orders" lang="prql" %}', 'from orders', '{% /query %}'].join('\n')
		);

		const { notebooks } = await walkProjectDirectory(dir);
		const cells = notebooks.flatMap((n) =>
			n.cells.filter((c) => !c.promotedModelPath && c.outputName.startsWith('orders'))
		);
		expect(cells.length).toBe(2);
		const ids = new Set(cells.map((c) => c.id));
		expect(ids.size).toBe(cells.length);
	});

	it('deconflicts a manifest-fallback model against an existing on-disk model name', async () => {
		await write('models/orders.prql', 'from raw_orders');
		await write(
			'target/manifest.json',
			JSON.stringify({
				nodes: {
					'model.proj.orders_v2': {
						name: 'orders',
						resource_type: 'model',
						original_file_path: 'models/orders_v2.sql',
						raw_code: 'select * from raw_orders_v2'
					}
				}
			})
		);

		const { notebooks } = await walkProjectDirectory(dir);
		const names = notebooks.flatMap((n) => n.cells.map((c) => c.outputName)).sort();
		expect(names).toEqual(['orders', 'orders_copy']);
	});
});

describe('trinoConnectionDefaults', () => {
	it('derives host/port/user from TRINO_URL', () => {
		vi.stubEnv('TRINO_URL', 'http://trino:8080');
		expect(trinoConnectionDefaults()).toMatchObject({ host: 'trino', port: 8080 });
		vi.stubEnv('TRINO_URL', 'https://trino.example.com:8443/');
		expect(trinoConnectionDefaults()).toMatchObject({
			host: 'trino.example.com',
			port: 8443,
			httpScheme: 'https'
		});
		vi.stubEnv('TRINO_URL', 'http://localhost:8067');
		vi.stubEnv('TRINO_USER', 'analyst');
		expect(trinoConnectionDefaults()).toMatchObject({ host: 'localhost', user: 'analyst' });
	});
});

describe('applyManagedTrinoBlock', () => {
	const TRINO_PROFILE = `myproj:
  target: dev
  outputs:
    dev:
      type: trino
      database: mycatalog
      schema: myschema
`;

	it('inserts connectivity from TRINO_URL and leaves owner keys alone', () => {
		vi.stubEnv('TRINO_URL', 'http://localhost:8067');
		const updated = applyManagedTrinoBlock(TRINO_PROFILE);
		expect(updated).toContain('host: localhost');
		expect(updated).toContain('port: 8067');
		expect(updated).toContain('Lunapad-managed');
		expect(updated).toContain('database: mycatalog');
		expect(updated).toContain('schema: myschema');
	});

	it('is idempotent and refreshes values when TRINO_URL changes', () => {
		vi.stubEnv('TRINO_URL', 'http://localhost:8067');
		const once = applyManagedTrinoBlock(TRINO_PROFILE);
		expect(applyManagedTrinoBlock(once)).toBe(once);
		vi.stubEnv('TRINO_URL', 'http://trino:8080');
		const refreshed = applyManagedTrinoBlock(once);
		expect(refreshed).toContain('host: trino');
		expect(refreshed).not.toContain('host: localhost');
		// Still exactly one managed block.
		expect(refreshed.match(/Lunapad-managed/g)?.length).toBe(1);
	});

	it('leaves non-trino profiles untouched', () => {
		const duckdb = `myproj:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n`;
		expect(applyManagedTrinoBlock(duckdb)).toBe(duckdb);
	});
});

describe('ensureManagedProfileDefaults', () => {
	it('is a no-op without profiles.yml and for non-trino adapters', async () => {
		await expect(ensureManagedProfileDefaults(dir)).resolves.toEqual({
			applied: false,
			adapter: null
		});
		await write('profiles.yml', `p:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n`);
		const before = await fs.readFile(path.join(dir, 'profiles.yml'), 'utf-8');
		await expect(ensureManagedProfileDefaults(dir)).resolves.toEqual({
			applied: false,
			adapter: 'duckdb'
		});
		expect(await fs.readFile(path.join(dir, 'profiles.yml'), 'utf-8')).toBe(before);
	});

	it('fills connectivity but refuses a trino target with no catalog', async () => {
		vi.stubEnv('TRINO_URL', 'http://trino:8080');
		await write(
			'profiles.yml',
			`p:\n  target: dev\n  outputs:\n    dev:\n      type: trino\n      database: ''\n      schema: ''\n`
		);
		await expect(ensureManagedProfileDefaults(dir)).rejects.toThrow(/database and schema/);
		// Connectivity was still written before the refusal.
		const content = await fs.readFile(path.join(dir, 'profiles.yml'), 'utf-8');
		expect(content).toContain('host: trino');
	});

	it('passes a fully-configured trino target', async () => {
		vi.stubEnv('TRINO_URL', 'http://trino:8080');
		await write(
			'profiles.yml',
			`p:\n  target: dev\n  outputs:\n    dev:\n      type: trino\n      database: cat\n      schema: public\n`
		);
		await expect(ensureManagedProfileDefaults(dir)).resolves.toMatchObject({ adapter: 'trino' });
	});
});

describe('scaffoldDbtProject adapters', () => {
	it('still scaffolds duckdb by default', async () => {
		await scaffoldDbtProject(dir, 'pwoject');
		const profiles = await fs.readFile(path.join(dir, 'profiles.yml'), 'utf-8');
		expect(profiles).toContain('type: duckdb');
	});

	it('scaffolds postgres and trino profiles', async () => {
		await scaffoldDbtProject(dir, 'pgproj', 'postgres');
		expect(await fs.readFile(path.join(dir, 'profiles.yml'), 'utf-8')).toContain('type: postgres');
		await fs.rm(path.join(dir, 'profiles.yml'));

		vi.stubEnv('TRINO_URL', 'http://trino:8080');
		await scaffoldDbtProject(dir, 'trinoproj', 'trino');
		const trino = await fs.readFile(path.join(dir, 'profiles.yml'), 'utf-8');
		expect(trino).toContain('type: trino');
	});
});
