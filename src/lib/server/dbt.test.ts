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
});
