import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteCellFile, renameCellFile, walkProjectDirectory } from './project.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-project-test-'));
});

afterEach(async () => {
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
