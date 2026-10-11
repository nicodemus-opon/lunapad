import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadManifest } from './dbt.js';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-dbt-test-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('loadManifest', () => {
	it('returns one model per unique path even if two manifest nodes share a name', async () => {
		await fs.mkdir(path.join(dir, 'target'), { recursive: true });
		await fs.writeFile(
			path.join(dir, 'target', 'manifest.json'),
			JSON.stringify({
				nodes: {
					'model.proj.orders_old': {
						name: 'orders',
						resource_type: 'model',
						path: 'staging/orders.sql'
					},
					'model.proj.orders_new': {
						name: 'orders',
						resource_type: 'model',
						path: 'marts/orders.sql'
					}
				}
			}),
			'utf-8'
		);

		const models = await loadManifest(dir);
		expect(models).toHaveLength(2);
		const paths = models.map((m) => m.path).sort();
		expect(paths).toEqual(['marts/orders.sql', 'staging/orders.sql']);
	});

	it('keeps the later manifest entry when the same path appears twice', async () => {
		await fs.mkdir(path.join(dir, 'target'), { recursive: true });
		await fs.writeFile(
			path.join(dir, 'target', 'manifest.json'),
			JSON.stringify({
				nodes: {
					'model.proj.orders_a': {
						name: 'orders',
						resource_type: 'model',
						path: 'staging/orders.sql',
						description: 'first'
					},
					'model.proj.orders_b': {
						name: 'orders',
						resource_type: 'model',
						path: 'staging/orders.sql',
						description: 'second'
					}
				}
			}),
			'utf-8'
		);

		const models = await loadManifest(dir);
		expect(models).toHaveLength(1);
		expect(models[0].description).toBe('second');
	});

	it('keeps versioned model deps instead of dropping their edges', async () => {
		await fs.mkdir(path.join(dir, 'target'), { recursive: true });
		await fs.writeFile(
			path.join(dir, 'target', 'manifest.json'),
			JSON.stringify({
				nodes: {
					'model.proj.orders.v1': {
						name: 'orders',
						resource_type: 'model',
						path: 'staging/orders.sql',
						depends_on: { nodes: [] }
					},
					'model.proj.revenue': {
						name: 'revenue',
						resource_type: 'model',
						path: 'marts/revenue.sql',
						depends_on: { nodes: ['model.proj.orders.v1'] }
					}
				}
			}),
			'utf-8'
		);

		const models = await loadManifest(dir);
		const revenue = models.find((m) => m.name === 'revenue');
		expect(revenue?.upstreamRefs).toEqual(['orders']);
	});

	it('falls back to scanning models/ with single- and double-quoted refs', async () => {
		await fs.mkdir(path.join(dir, 'models', 'marts'), { recursive: true });
		await fs.writeFile(
			path.join(dir, 'models', 'marts', 'revenue.sql'),
			'select * from {{ ref(\'orders\') }} join {{ ref("customers") }}',
			'utf-8'
		);

		const models = await loadManifest(dir);
		expect(models).toHaveLength(1);
		expect(models[0].name).toBe('revenue');
		expect(models[0].upstreamRefs.sort()).toEqual(['customers', 'orders']);
	});

	it('falls back to an empty list (not a crash) when models/ is missing', async () => {
		const models = await loadManifest(dir);
		expect(models).toEqual([]);
	});
});

describe('loadManifest path normalization', () => {
	async function writeManifest(nodePath: string, extra: Record<string, unknown> = {}) {
		await fs.mkdir(path.join(dir, 'target'), { recursive: true });
		await fs.writeFile(
			path.join(dir, 'target', 'manifest.json'),
			JSON.stringify({
				nodes: {
					'model.proj.orders': {
						name: 'orders',
						resource_type: 'model',
						path: nodePath,
						...extra
					}
				}
			}),
			'utf-8'
		);
	}

	it('leaves a dbt-core path (root-relative) untouched', async () => {
		await writeManifest('staging/orders.sql');
		const models = await loadManifest(dir);
		expect(models[0].path).toBe('staging/orders.sql');
	});

	// dbt-fusion emits "models/staging/orders.sql". Before the fix this was passed
	// through verbatim, so backfillColumnsFromManifest re-joined "models" and
	// mkdir'd a phantom models/models/ tree inside the user's project.
	it('strips the model-path prefix from a dbt-fusion path', async () => {
		await writeManifest('models/staging/orders.sql');
		const models = await loadManifest(dir);
		expect(models[0].path).toBe('staging/orders.sql');
	});

	it('honours a non-default model-paths entry', async () => {
		await fs.writeFile(
			path.join(dir, 'dbt_project.yml'),
			'name: \'proj\'\nmodel-paths: ["src/sql"]\n',
			'utf-8'
		);
		await writeManifest('src/sql/staging/orders.sql');
		const models = await loadManifest(dir);
		expect(models[0].path).toBe('staging/orders.sql');
	});

	it('keeps both flavours pointing at the same key so they cannot collide', async () => {
		await writeManifest('models/staging/orders.sql');
		const [fusion] = await loadManifest(dir);
		await writeManifest('staging/orders.sql');
		const [core] = await loadManifest(dir);
		expect(fusion.path).toBe(core.path);
	});
});

describe('loadManifest column tests', () => {
	it('surfaces manifest column tests instead of always returning []', async () => {
		await fs.mkdir(path.join(dir, 'target'), { recursive: true });
		await fs.writeFile(
			path.join(dir, 'target', 'manifest.json'),
			JSON.stringify({
				nodes: {
					'model.proj.orders': {
						name: 'orders',
						resource_type: 'model',
						path: 'staging/orders.sql',
						columns: {
							order_id: {
								name: 'order_id',
								data_type: 'integer',
								tests: { not_null: {}, unique: {} }
							},
							total: {
								name: 'total',
								data_type: 'numeric',
								data_tests: { accepted_values: {} }
							}
						}
					}
				}
			}),
			'utf-8'
		);

		const models = await loadManifest(dir);
		const byName = new Map(models[0].columns.map((c) => [c.name, c]));
		expect(byName.get('order_id')?.tests.sort()).toEqual(['not_null', 'unique']);
		expect(byName.get('total')?.tests).toEqual(['accepted_values']);
		expect(byName.get('order_id')?.dataType).toBe('integer');
	});
});
