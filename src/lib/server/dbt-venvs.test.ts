import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	adapterPackage,
	collectProjectAdapters,
	dbtVenvsRoot,
	getDbtAdapterStatus,
	isProvisioning,
	reconcileDbtAdapters,
	venvBinary,
	venvBinaryExists,
	venvDir
} from './dbt-venvs.js';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('adapterPackage', () => {
	it('derives the pip package from dbt naming convention', () => {
		expect(adapterPackage('duckdb')).toBe('dbt-duckdb');
		expect(adapterPackage('postgres')).toBe('dbt-postgres');
		expect(adapterPackage('trino')).toBe('dbt-trino');
		expect(adapterPackage('Trino')).toBe('dbt-trino');
	});

	it('rejects an empty adapter type', () => {
		expect(() => adapterPackage('  ')).toThrow();
	});
});

describe('venv locations', () => {
	it('honors DBT_VENVS_DIR', async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-venvs-'));
		try {
			vi.stubEnv('DBT_VENVS_DIR', tmp);
			expect(dbtVenvsRoot()).toBe(tmp);
			expect(venvDir('trino')).toBe(path.join(tmp, 'trino'));
			expect(venvBinary('trino')).toBe(
				path.join(
					tmp,
					'trino',
					process.platform === 'win32' ? 'Scripts' : 'bin',
					process.platform === 'win32' ? 'dbt.exe' : 'dbt'
				)
			);
			expect(venvBinaryExists('trino')).toBe(false);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});

describe('collectProjectAdapters', () => {
	it('collects adapters from a root project and nested projects', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-venvs-roots-'));
		try {
			await fs.writeFile(
				path.join(root, 'profiles.yml'),
				`top:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n`,
				'utf-8'
			);
			// A nested-projects root (no top-level profiles.yml).
			const nested = path.join(root, 'nested');
			await fs.mkdir(path.join(nested, 'proj-trino'), { recursive: true });
			await fs.mkdir(path.join(nested, 'proj-pg'), { recursive: true });
			await fs.mkdir(path.join(nested, 'empty'), { recursive: true });
			await fs.writeFile(
				path.join(nested, 'proj-trino', 'profiles.yml'),
				`a:\n  target: dev\n  outputs:\n    dev:\n      type: trino\n      host: x\n`,
				'utf-8'
			);
			await fs.writeFile(
				path.join(nested, 'proj-pg', 'profiles.yml'),
				`b:\n  target: dev\n  outputs:\n    dev:\n      type: postgres\n`,
				'utf-8'
			);
			expect(collectProjectAdapters([root]).sort()).toEqual(['duckdb']);
			expect(collectProjectAdapters([nested]).sort()).toEqual(['postgres', 'trino']);
			expect(collectProjectAdapters([path.join(root, 'does-not-exist')])).toEqual([]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});

describe('reconcileDbtAdapters', () => {
	it('is a no-op with no projects and creates nothing', async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-venvs-'));
		try {
			vi.stubEnv('DBT_VENVS_DIR', tmp);
			await expect(reconcileDbtAdapters([path.join(tmp, 'missing')])).resolves.toEqual({
				adapters: []
			});
			expect(await fs.readdir(tmp)).toEqual([]);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});

describe('adapter status', () => {
	it('reports a fresh adapter as idle with no error', async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-venvs-'));
		try {
			vi.stubEnv('DBT_VENVS_DIR', tmp);
			const status = getDbtAdapterStatus('definitely-not-provisioned-xyz');
			expect(status.ready).toBe(false);
			expect(status.provisioning).toBe(false);
			expect(status.error).toBeNull();
			expect(status.package).toBe('dbt-definitely-not-provisioned-xyz');
			expect(isProvisioning('definitely-not-provisioned-xyz')).toBe(false);
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});
});
