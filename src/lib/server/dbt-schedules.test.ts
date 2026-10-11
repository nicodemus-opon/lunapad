import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	getCurrentFolder,
	isDueNow,
	isValidCron,
	getNextRuns,
	listScheduleFolders,
	loadSchedules,
	saveSchedules,
	setCurrentFolder,
	upsertSchedule,
	deleteSchedule
} from './dbt-schedules.js';
import type { DbtSchedule } from '$lib/types/schedule';

let root: string;
let projectsRoot: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'lunapad-sched-'));
	projectsRoot = path.join(root, 'projects');
	await fs.mkdir(projectsRoot, { recursive: true });
	for (const key of ['PROJECTS_ROOT', 'PROJECT_FOLDER', 'LUNAPAD_PROJECT_ROOTS', 'PROJECT_ROOT']) {
		savedEnv[key] = process.env[key];
	}
	process.env.PROJECTS_ROOT = projectsRoot;
	// Allow anything under `root` so a folder can legitimately live outside the
	// scanned projects tree.
	process.env.LUNAPAD_PROJECT_ROOTS = root;
	delete process.env.PROJECT_FOLDER;
	delete process.env.PROJECT_ROOT;
	setCurrentFolder(null);
});

afterEach(async () => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	setCurrentFolder(null);
	await fs.rm(root, { recursive: true, force: true });
});

function schedule(over: Partial<DbtSchedule> = {}): DbtSchedule {
	return {
		id: 's1',
		label: 'nightly',
		select: 'orders',
		cron: '0 3 * * *',
		enabled: true,
		createdAt: Date.now(),
		lastRunAt: null,
		lastRunStatus: null,
		lastRunJobId: null,
		...over
	};
}

describe('cron helpers', () => {
	it('accepts valid cron expressions', () => {
		expect(isValidCron('*/5 * * * *')).toBe(true);
		expect(isValidCron('0 3 * * *')).toBe(true);
	});

	it('rejects invalid cron expressions', () => {
		expect(isValidCron('not a cron')).toBe(false);
		expect(isValidCron('')).toBe(false);
	});

	it('reports due only within the current minute', () => {
		// Every-minute cron is always due now; a once-a-year cron never is.
		expect(isDueNow('* * * * *')).toBe(true);
		expect(isDueNow('0 0 1 1 *')).toBe(false);
	});

	it('returns upcoming runs for a valid cron and none for an invalid one', () => {
		expect(getNextRuns('0 * * * *', 3)).toHaveLength(3);
		expect(getNextRuns('nonsense', 3)).toEqual([]);
	});
});

describe('persistence', () => {
	it('round-trips schedules and returns [] for a missing file', async () => {
		const folder = path.join(root, 'p1');
		await fs.mkdir(folder, { recursive: true });
		expect(loadSchedules(folder)).toEqual([]);

		saveSchedules(folder, [schedule()]);
		expect(loadSchedules(folder)).toHaveLength(1);
		expect(loadSchedules(folder)[0].label).toBe('nightly');
	});

	it('upserts by id rather than duplicating', async () => {
		const folder = path.join(root, 'p1');
		await fs.mkdir(folder, { recursive: true });

		upsertSchedule(folder, schedule());
		upsertSchedule(folder, schedule({ label: 'renamed' }));

		const all = loadSchedules(folder);
		expect(all).toHaveLength(1);
		expect(all[0].label).toBe('renamed');
	});

	it('deletes by id', async () => {
		const folder = path.join(root, 'p1');
		await fs.mkdir(folder, { recursive: true });
		upsertSchedule(folder, schedule());
		deleteSchedule(folder, 's1');
		expect(loadSchedules(folder)).toEqual([]);
	});
});

describe('listScheduleFolders', () => {
	// The scheduler used to read a single in-memory "current folder". That is
	// per-process (so a cron callback on another replica saw nothing) and
	// single-valued (so only the last-opened project was ever scheduled).
	async function makeProject(org: string, project: string, withSchedules: boolean) {
		const folder = path.join(projectsRoot, org, project);
		await fs.mkdir(folder, { recursive: true });
		if (withSchedules) {
			await fs.writeFile(path.join(folder, 'schedules.json'), JSON.stringify([schedule()]));
		}
		return folder;
	}

	it('finds every project that has a schedules.json', async () => {
		await makeProject('org_a', 'p1', true);
		await makeProject('org_a', 'p2', true);
		await makeProject('org_b', 'p3', true);

		const found = listScheduleFolders()
			.map((f) => path.relative(projectsRoot, f))
			.sort();
		expect(found).toEqual([
			path.join('org_a', 'p1'),
			path.join('org_a', 'p2'),
			path.join('org_b', 'p3')
		]);
	});

	it('ignores projects with no schedules.json', async () => {
		await makeProject('org_a', 'p1', true);
		await makeProject('org_a', 'p2', false);

		const found = listScheduleFolders().map((f) => path.relative(projectsRoot, f));
		expect(found).toEqual([path.join('org_a', 'p1')]);
	});

	it('includes the current folder even when it lives outside the projects root', async () => {
		const outside = path.join(root, 'standalone');
		await fs.mkdir(outside, { recursive: true });
		setCurrentFolder(outside);

		expect(listScheduleFolders()).toContain(path.resolve(outside));
	});

	it('deduplicates the current folder when it is also under the projects root', async () => {
		const folder = await makeProject('org_a', 'p1', true);
		setCurrentFolder(folder);

		const found = listScheduleFolders();
		expect(found.filter((f) => f === path.resolve(folder))).toHaveLength(1);
	});

	it('returns [] rather than throwing when the root does not exist', async () => {
		process.env.PROJECTS_ROOT = path.join(root, 'does-not-exist');
		setCurrentFolder(null);
		expect(listScheduleFolders()).toEqual([]);
	});

	it('exposes the current folder through its getter', () => {
		expect(getCurrentFolder()).toBeNull();
		setCurrentFolder(root);
		expect(getCurrentFolder()).toBe(root);
	});
});
