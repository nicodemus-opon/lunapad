import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// ── Adapter → pip package, by convention ──────────────────────────────────────
// dbt names its adapter plugins dbt-<type> almost universally, so there is no
// package matrix to maintain: the package is derived, not listed. Genuine
// exceptions (an adapter whose plugin breaks the convention) go here.
const ADAPTER_PACKAGE_EXCEPTIONS: Record<string, string> = {};

export function adapterPackage(adapter: string): string {
	const key = adapter.trim().toLowerCase();
	if (!key) throw new Error('dbt adapter type is empty.');
	return ADAPTER_PACKAGE_EXCEPTIONS[key] ?? `dbt-${key}`;
}

/** Parse the adapter type from a project's profiles.yml (first `type:` match). */
export function readAdapter(projectFolder: string): string {
	try {
		const content = fs.readFileSync(path.join(projectFolder, 'profiles.yml'), 'utf-8');
		const m = content.match(/^\s+type:\s*(\w+)/m);
		return m?.[1]?.toLowerCase() ?? 'duckdb';
	} catch {
		return 'duckdb';
	}
}

// ── Venv locations ────────────────────────────────────────────────────────────
// One isolated venv per adapter: adapters can never break each other through
// shared dependencies (the failure mode of a single system-wide dbt install
// on a multi-tenant box), and provisioning never touches system Python.

interface CachedRoot {
	env: string | undefined;
	root: string;
}

let cachedRoot: CachedRoot | null = null;

/** Root dir for per-adapter venvs. `/opt` in containers, home dir on laptops. */
export function dbtVenvsRoot(): string {
	const env = process.env.DBT_VENVS_DIR?.trim() || undefined;
	if (cachedRoot && cachedRoot.env === env) return cachedRoot.root;
	let root: string;
	if (env) {
		root = env;
	} else {
		const system = '/opt/dbt-venvs';
		try {
			fs.mkdirSync(system, { recursive: true });
			fs.accessSync(system, fs.constants.W_OK);
			root = system;
		} catch {
			root = path.join(os.homedir(), '.lunapad', 'dbt-venvs');
		}
	}
	cachedRoot = { env, root };
	return root;
}

function systemPython(): string {
	return process.platform === 'win32' ? 'python' : 'python3';
}

export function venvDir(adapter: string): string {
	return path.join(dbtVenvsRoot(), adapter.trim().toLowerCase());
}

export function venvPython(adapter: string): string {
	const dir = venvDir(adapter);
	return process.platform === 'win32'
		? path.join(dir, 'Scripts', 'python.exe')
		: path.join(dir, 'bin', 'python');
}

export function venvBinary(adapter: string): string {
	const dir = venvDir(adapter);
	return process.platform === 'win32'
		? path.join(dir, 'Scripts', 'dbt.exe')
		: path.join(dir, 'bin', 'dbt');
}

/** Sync existence check for hot paths (correctness is verified at provision time). */
export function venvBinaryExists(adapter: string): boolean {
	return fs.existsSync(venvBinary(adapter.trim().toLowerCase()));
}

/**
 * True when the venv exists and its interpreter imports the adapter.
 * Async — the import can take seconds on first run, so this must never sit
 * on a sync hot path (use `venvBinaryExists` there instead).
 */
export async function venvReady(adapter: string): Promise<boolean> {
	const key = adapter.trim().toLowerCase();
	if (!fs.existsSync(venvBinary(key))) return false;
	try {
		await execFileAsync(venvPython(key), ['-c', `import dbt.adapters.${key}`], {
			timeout: 60_000
		});
		return true;
	} catch {
		return false;
	}
}

// ── Provisioning state ────────────────────────────────────────────────────────

export interface DbtAdapterStatus {
	adapter: string;
	/** Usable right now (venv present, adapter importable). */
	ready: boolean;
	/** A background provisioning run is in flight. */
	provisioning: boolean;
	binary: string;
	/** pip package that provides the adapter, by convention. */
	package: string;
	/** Last provisioning failure, if any. */
	error: string | null;
}

interface AdapterState {
	provisioning: Promise<string> | null;
	error: string | null;
	errorAt: number;
}

const states = new Map<string, AdapterState>();

function stateFor(adapter: string): AdapterState {
	const key = adapter.trim().toLowerCase();
	let state = states.get(key);
	if (!state) {
		state = { provisioning: null, error: null, errorAt: 0 };
		states.set(key, state);
	}
	return state;
}

/** Cooldown before a failed provisioning is retried (30s). */
const PROVISION_RETRY_COOLDOWN_MS = 30_000;

/**
 * Provision (or re-provision) the venv for an adapter: stdlib `venv` +
 * `pip install <dbt-<type>>`. One flight per adapter; concurrent callers share
 * it. A half-failed venv is removed so the next attempt starts clean.
 */
export function ensureDbtVenv(
	adapter: string,
	onProgress?: (line: string) => void
): Promise<string> {
	const key = adapter.trim().toLowerCase();
	const state = stateFor(key);
	if (state.provisioning) return state.provisioning;

	const task = (async (): Promise<string> => {
		const pkg = adapterPackage(key);
		const dir = venvDir(key);
		onProgress?.(`Provisioning dbt adapter "${key}" (${pkg})…`);
		try {
			await execFileAsync(systemPython(), ['-m', 'venv', dir], { timeout: 300_000 });
			const python = venvPython(key);
			await execFileAsync(python, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], {
				timeout: 300_000
			});
			await execFileAsync(python, ['-m', 'pip', 'install', '--quiet', pkg], {
				timeout: 600_000
			});
		} catch (err) {
			const detail =
				(err as { stderr?: unknown })?.stderr ?? (err as Error)?.message ?? 'unknown error';
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
			throw new Error(
				`Failed to provision dbt adapter "${key}" (${pkg}): ${String(detail).slice(-2000)}`
			);
		}
		if (!(await venvReady(key))) {
			throw new Error(
				`Installed ${pkg} but dbt adapter "${key}" is still not importable in ${venvDir(key)}.`
			);
		}
		onProgress?.(`dbt adapter "${key}" ready.`);
		return venvBinary(key);
	})();

	state.provisioning = task;
	state.error = null;
	void task.then(
		() => {
			state.provisioning = null;
			state.error = null;
		},
		(err) => {
			state.provisioning = null;
			state.error = err instanceof Error ? err.message : String(err);
			state.errorAt = Date.now();
		}
	);
	return task;
}

export function getDbtAdapterStatus(adapter: string): DbtAdapterStatus {
	const key = adapter.trim().toLowerCase();
	const state = states.get(key);
	return {
		adapter: key,
		// Existence-only here: the import probe is async and belongs to
		// health checks / provisioning verification, not status snapshots.
		ready: venvBinaryExists(key) && !state?.error,
		provisioning: state?.provisioning !== null && state?.provisioning !== undefined,
		binary: venvBinary(key),
		package: adapterPackage(key),
		error: state?.error ?? null
	};
}

/** Provisioning/error snapshot without any subprocess probes (safe on hot paths). */
export function isProvisioning(adapter: string): boolean {
	const state = states.get(adapter.trim().toLowerCase());
	return state?.provisioning !== null && state?.provisioning !== undefined;
}

export function lastProvisionError(adapter: string): string | null {
	return states.get(adapter.trim().toLowerCase())?.error ?? null;
}

export function getDbtAdapterStatuses(): DbtAdapterStatus[] {
	return [...states.keys()].map((adapter) => getDbtAdapterStatus(adapter));
}

/** True when a new background provisioning attempt may start (cooldown elapsed). */
export function mayRetryProvision(adapter: string): boolean {
	const state = states.get(adapter.trim().toLowerCase());
	if (!state) return true;
	if (state.provisioning) return false;
	if (!state.error) return true;
	return Date.now() - state.errorAt > PROVISION_RETRY_COOLDOWN_MS;
}

// ── Reconciliation ────────────────────────────────────────────────────────────

/** Project folders directly under a root: the root itself if it holds a project. */
function candidateProjectFolders(root: string): string[] {
	try {
		if (fs.existsSync(path.join(root, 'profiles.yml'))) return [root];
		const entries = fs.readdirSync(root, { withFileTypes: true });
		const found: string[] = [];
		for (const entry of entries) {
			if (found.length >= 100) break;
			if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
			const candidate = path.join(root, entry.name);
			try {
				if (fs.existsSync(path.join(candidate, 'profiles.yml'))) found.push(candidate);
			} catch {
				// ignore unreadable entries
			}
		}
		return found;
	} catch {
		return [];
	}
}

/** Collect every adapter type referenced by projects under the given roots. */
export function collectProjectAdapters(roots: string[]): string[] {
	const adapters = new Set<string>();
	for (const root of roots) {
		for (const folder of candidateProjectFolders(root)) {
			try {
				adapters.add(readAdapter(folder));
			} catch {
				// ignore unreadable projects
			}
		}
	}
	return [...adapters];
}

/** Project roots from the same env the rest of the server honors. */
export function configuredProjectRoots(): string[] {
	const raw = [
		process.env.LUNAPAD_PROJECT_ROOTS,
		process.env.PROJECTS_ROOT,
		process.env.PROJECT_ROOT,
		process.env.PROJECT_FOLDER
	]
		.filter(Boolean)
		.join(path.delimiter);
	return raw
		.split(path.delimiter)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => path.resolve(p));
}

/**
 * Warm the venv for every adapter referenced by mounted projects.
 * Runs in the background at boot and on project open; per-adapter failures
 * resolve independently and never reject the whole reconciliation.
 */
export async function reconcileDbtAdapters(
	roots?: string[],
	onProgress?: (line: string) => void
): Promise<{ adapters: string[] }> {
	const adapters = collectProjectAdapters(roots ?? configuredProjectRoots());
	await Promise.allSettled(adapters.map((adapter) => ensureDbtVenv(adapter, onProgress)));
	return { adapters };
}

/** Fire-and-forget boot hook: warm venvs without delaying server startup. */
let reconcilerStarted = false;

export function startDbtAdapterReconciler(): void {
	if (reconcilerStarted) return;
	reconcilerStarted = true;
	if (process.env.DBT_VENVS_RECONCILE_ON_STARTUP === 'false') return;
	// Demo mode blocks /api/dbt entirely (see hooks.server.ts), so there is
	// nothing to provision for.
	if (process.env.DEMO_MODE === '1') return;
	void reconcileDbtAdapters().then(
		({ adapters }) => {
			if (adapters.length > 0)
				console.log(`[dbt-venvs] reconciled adapters: ${adapters.join(', ')}`);
		},
		(err) => console.warn('[dbt-venvs] reconciliation failed:', (err as Error)?.message)
	);
}
