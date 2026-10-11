import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	findSchemaFile,
	parseSchemaYaml,
	serializeSchemaYaml,
	readSchemaFile,
	writeSchemaFile,
	upsertModelEntry
} from './dbt-schema.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-dbt-schema-'));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(dir, { recursive: true, force: true });
});

describe('findSchemaFile', () => {
	it('prefers the app-owned _models.yml when it already exists', async () => {
		await fs.mkdir(path.join(dir, 'models', 'staging'), { recursive: true });
		await fs.writeFile(path.join(dir, 'models', 'staging', '_models.yml'), 'version: 2\n');

		const found = findSchemaFile(dir, 'models/staging/orders.sql');
		expect(found).toBe(path.join(dir, 'models', 'staging', '_models.yml'));
	});

	// Most dbt projects use schema.yml, not _models.yml. Hardcoding the app's own
	// filename meant those projects got no descriptions at all.
	it('falls back to a sibling schema.yml', async () => {
		await fs.mkdir(path.join(dir, 'models', 'staging'), { recursive: true });
		await fs.writeFile(path.join(dir, 'models', 'staging', 'schema.yml'), 'version: 2\n');

		expect(findSchemaFile(dir, 'models/staging/orders.sql')).toBe(
			path.join(dir, 'models', 'staging', 'schema.yml')
		);
	});

	it('falls back to a model-named yml', async () => {
		await fs.mkdir(path.join(dir, 'models'), { recursive: true });
		await fs.writeFile(path.join(dir, 'models', 'orders.yml'), 'version: 2\n');

		expect(findSchemaFile(dir, 'models/orders.sql')).toBe(path.join(dir, 'models', 'orders.yml'));
	});

	it('defaults to _models.yml when nothing exists yet', () => {
		expect(findSchemaFile(dir, 'models/orders.sql')).toBe(path.join(dir, 'models', '_models.yml'));
	});
});

describe('lossy write protection', () => {
	// serializeSchemaYaml only models name/description/config/columns. Rewriting a
	// project that uses data_tests/meta/constraints silently deleted them — and
	// backfillColumnsFromManifest runs on every manifest refresh.
	it('marks a file with unmodelled column keys as lossy', () => {
		const parsed = parseSchemaYaml(
			[
				'version: 2',
				'models:',
				'  - name: orders',
				'    columns:',
				'      - name: id',
				'        data_tests:',
				'          - unique'
			].join('\n')
		);
		expect(parsed.lossy).toBe(true);
	});

	it('marks unmodelled model-level keys as lossy', () => {
		const parsed = parseSchemaYaml(
			['version: 2', 'models:', '  - name: orders', '    meta:', '      owner: data'].join('\n')
		);
		expect(parsed.lossy).toBe(true);
	});

	it('does not mark an ordinary file as lossy', () => {
		const parsed = parseSchemaYaml(
			[
				'version: 2',
				'models:',
				'  - name: orders',
				'    description: Orders',
				'    config:',
				'      materialized: view',
				'    columns:',
				'      - name: id',
				'        tests:',
				'          - not_null'
			].join('\n')
		);
		expect(parsed.lossy).toBeFalsy();
	});

	it('refuses to overwrite a lossy file, leaving it byte-identical', async () => {
		const yml = path.join(dir, '_models.yml');
		const original = [
			'version: 2',
			'models:',
			'  - name: orders',
			'    meta:',
			'      owner: data'
		].join('\n');
		await fs.writeFile(yml, original, 'utf-8');

		const parsed = await readSchemaFile(yml);
		const updated = upsertModelEntry(parsed, 'orders', { description: 'new text' });
		await writeSchemaFile(yml, updated);

		expect(await fs.readFile(yml, 'utf-8')).toBe(original);
	});

	it('still writes files it can round-trip', async () => {
		const yml = path.join(dir, '_models.yml');
		const parsed = await readSchemaFile(yml);
		const updated = upsertModelEntry(parsed, 'orders', { description: 'Orders' });
		await writeSchemaFile(yml, updated);

		const written = await fs.readFile(yml, 'utf-8');
		expect(written).toContain('name: orders');
		expect(written).toContain('description: Orders');
	});
});

describe('round trip', () => {
	it('preserves a supported file through parse -> serialize -> parse', () => {
		const source = [
			'version: 2',
			'models:',
			'  - name: orders',
			'    description: The orders table',
			'    config:',
			'      materialized: table',
			'    columns:',
			'      - name: id',
			'        description: The id',
			'        tests:',
			'          - not_null'
		].join('\n');

		const once = parseSchemaYaml(source);
		const twice = parseSchemaYaml(serializeSchemaYaml(once));
		expect(twice).toEqual(once);
		expect(twice.models[0].columns?.[0].tests).toEqual(['not_null']);
	});
});
