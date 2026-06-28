import fs from 'node:fs/promises';
import path from 'node:path';
import { assertSafe } from './project.js';

/**
 * Project-level pinned Python packages, beyond the curated set
 * (pandas/numpy/pyarrow/plotly) that's always pre-provisioned. Stored under
 * the open dbt project folder so it's checked into git like everything else
 * under `models/`/`analyses/` — a teammate cloning the repo gets the same
 * extras auto-installed into their machine's managed venv with no manual
 * steps (see `python-runner.ts`'s `ensureProjectPinnedPackages`).
 */
export interface PinnedPackage {
	name: string;
	version: string | null;
}

function pinnedPath(folder: string): string {
	return path.join(folder, '.lunapad', 'python-packages.json');
}

export async function readPinnedPackages(folder: string): Promise<PinnedPackage[]> {
	try {
		const filePath = pinnedPath(folder);
		assertSafe(folder, filePath);
		const raw = await fs.readFile(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? (parsed as PinnedPackage[]) : [];
	} catch {
		return [];
	}
}

async function writePinnedPackages(folder: string, packages: PinnedPackage[]): Promise<void> {
	const filePath = pinnedPath(folder);
	assertSafe(folder, filePath);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(packages, null, 2) + '\n', 'utf-8');
}

export async function addPinnedPackage(folder: string, pkg: PinnedPackage): Promise<void> {
	const existing = await readPinnedPackages(folder);
	const next = [...existing.filter((p) => p.name.toLowerCase() !== pkg.name.toLowerCase()), pkg];
	await writePinnedPackages(folder, next);
}

export async function removePinnedPackage(folder: string, name: string): Promise<void> {
	const existing = await readPinnedPackages(folder);
	await writePinnedPackages(
		folder,
		existing.filter((p) => p.name.toLowerCase() !== name.toLowerCase())
	);
}
