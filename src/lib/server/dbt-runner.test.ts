import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getJob, killJob, resolveDbtBinary, spawnDbt } from './dbt-runner.js';

let root: string;
let goodProject: string;
let badProject: string;
const savedEnv: Record<string, string | undefined> = {};

/** These drive the real CLI, so skip cleanly where dbt isn't installed. */
function dbtAvailable(): boolean {
	try {
		execFileSync('dbt', ['--version'], { stdio: 'ignore', timeout: 30_000 });
		return true;
	} catch {
		return false;
	}
}
const HAS_DBT = dbtAvailable();
// dbt-fusion needs several seconds per invocation to boot and parse.
const DBT_TIMEOUT = 120_000;

async function makeProject(name: string, modelSql: string): Promise<string> {
	const folder = path.join(root, name);
	await fs.mkdir(path.join(folder, 'models'), { recursive: true });
	await fs.writeFile(
		path.join(folder, 'dbt_project.yml'),
		`name: '${name}'\nversion: '1.0.0'\nconfig-version: 2\nprofile: '${name}'\nmodel-paths: ["models"]\n`,
		'utf-8'
	);
	await fs.writeFile(
		path.join(folder, 'profiles.yml'),
		`${name}:\n  target: dev\n  outputs:\n    dev:\n      type: duckdb\n      path: ':memory:'\n`,
		'utf-8'
	);
	await fs.writeFile(path.join(folder, 'models', 'simple.sql'), modelSql, 'utf-8');
	return folder;
}

interface RunResult {
	exitCode: number | null;
	lines: string[];
	doneCount: number;
}

function waitFor(jobId: string): Promise<RunResult> {
	return new Promise((resolve) => {
		const job = getJob(jobId)!;
		let doneCount = 0;
		job.emitter.on('done', () => doneCount++);
		if (job.done) {
			resolve({ exitCode: job.exitCode, lines: [...job.lines], doneCount });
			return;
		}
		job.emitter.once('done', () => {
			// Let any trailing stdout chunk land before snapshotting the buffer.
			setTimeout(() => resolve({ exitCode: job.exitCode, lines: [...job.lines], doneCount }), 100);
		});
	});
}

// One invocation per scenario, shared across assertions: the CLI is slow enough
// that re-running per assertion would dominate the suite.
let goodRun: RunResult;
let badRun: RunResult;

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-dbt-runner-'));
	for (const key of ['PROJECT_FOLDER', 'PROJECTS_ROOT', 'LUNAPAD_PROJECT_ROOTS', 'PROJECT_ROOT']) {
		savedEnv[key] = process.env[key];
	}
	process.env.LUNAPAD_PROJECT_ROOTS = root;
	process.env.PROJECTS_ROOT = root;
	delete process.env.PROJECT_FOLDER;
	delete process.env.PROJECT_ROOT;

	goodProject = await makeProject('goodproj', 'select 1 as id\n');
	// References a model that does not exist, so dbt exits non-zero.
	badProject = await makeProject('badproj', 'select * from {{ ref("does_not_exist") }}\n');

	if (HAS_DBT) {
		goodRun = await waitFor(spawnDbt(['compile'], goodProject));
		badRun = await waitFor(spawnDbt(['compile'], badProject));
	}
}, DBT_TIMEOUT);

afterAll(async () => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	await fs.rm(root, { recursive: true, force: true });
});

describe('spawnDbt', () => {
	it('rejects folders outside the configured roots', () => {
		expect(() =>
			spawnDbt(['--version'], path.join(os.tmpdir(), 'definitely-not-allowed'))
		).toThrow();
	});

	it('registers the job immediately so logs can be subscribed to', () => {
		const jobId = spawnDbt(['--version'], goodProject);
		expect(getJob(jobId)).toBeDefined();
		expect(getJob(jobId)!.id).toBe(jobId);
	});

	it.skipIf(!HAS_DBT)('exits 0 and captures output on success', () => {
		expect(goodRun.exitCode).toBe(0);
		expect(goodRun.lines.length).toBeGreaterThan(0);
		expect(goodRun.lines.join('\n')).toContain('success');
	});

	it.skipIf(!HAS_DBT)('captures stderr and a non-zero exit on failure', () => {
		expect(badRun.exitCode).not.toBe(0);
		expect(badRun.lines.join('\n')).toContain('error');
	});

	it.skipIf(!HAS_DBT)('emits done exactly once', () => {
		expect(goodRun.doneCount).toBe(1);
	});

	it.skipIf(!HAS_DBT)('drops blank lines rather than emitting empty log entries', () => {
		expect(goodRun.lines.every((l) => l.trim() !== '')).toBe(true);
	});

	it.skipIf(!HAS_DBT)('writes the manifest a subsequent load would read', async () => {
		const stat = await fs.stat(path.join(goodProject, 'target', 'manifest.json'));
		expect(stat.size).toBeGreaterThan(0);
	});
});

describe('killJob', () => {
	it('is a no-op for an unknown job id', () => {
		expect(() => killJob('does-not-exist')).not.toThrow();
	});
});

describe('getJob', () => {
	it('returns undefined for an unknown id', () => {
		expect(getJob('nope')).toBeUndefined();
	});
});

describe('resolveDbtBinary', () => {
	it('uses the fusion path when no adapter can be read', () => {
		expect(resolveDbtBinary(root)).toBe('dbt');
	});

	it('returns a string for a project with no profiles.yml', () => {
		expect(typeof resolveDbtBinary(root)).toBe('string');
	});
});
