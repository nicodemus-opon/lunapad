import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { assertAllowedProjectFolder } from './project.js';
import os from 'node:os';
import {
	adapterPackage,
	ensureDbtVenv,
	isProvisioning,
	lastProvisionError,
	mayRetryProvision,
	readAdapter,
	venvBinary,
	venvBinaryExists
} from './dbt-venvs.js';

// Re-exported for callers/tests that resolve adapters per project folder.
export { readAdapter };

export interface DbtJob {
	id: string;
	process: ChildProcess;
	emitter: EventEmitter;
	done: boolean;
	exitCode: number | null;
	lines: string[];
}

const jobs = new Map<string, DbtJob>();

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// ── Adapter-aware binary resolution ──────────────────────────────────────────
// Resolution order per project folder (adapter read from its profiles.yml):
//   1. PATH `dbt` when it genuinely supports the adapter (local dbt-fusion,
//      or a fully-provisioned system install) — zero setup, fastest.
//   2. The adapter's isolated venv (/opt/dbt-venvs/<adapter>/bin/dbt), warmed
//      at server boot and on project open — the cloud multi-adapter path.
//   3. Legacy local Python dbt installs (Homebrew, user site, project venvs).
//   4. Fallback `dbt` — ensureDbtAdapter() turns this into provisioning or a
//      descriptive error instead of a cryptic exit code.

/**
 * Adapters compiled into the dbt-fusion binary. A PATH `dbt` that is a
 * compiled (shebang-less) binary is assumed to cover these; a Python-backed
 * `dbt` is probed for real (see `binarySupportsAdapter`).
 */
const FUSION_ADAPTERS = new Set([
	'duckdb',
	'postgres',
	'redshift',
	'snowflake',
	'bigquery',
	'trino',
	'datafusion',
	'spark',
	'databricks',
	'salesforce',
	'fabric'
]);

/** Cache: adapter type → resolved binary path. */
const binaryCache = new Map<string, string>();

/**
 * Resolve the dbt binary for the given project folder.
 * The binary is chosen based on the project's adapter type (read from
 * profiles.yml): PATH `dbt` when it supports the adapter, otherwise the
 * adapter's isolated venv, otherwise a legacy local install.
 */
export function resolveDbtBinary(projectFolder: string): string {
	const adapter = readAdapter(projectFolder);
	// Trusted without re-probing: every spawn pays only a map lookup.
	// ensureDbtAdapter() explicitly invalidates this cache before re-resolving
	// once provisioning completes, so freshness is handled there, not here.
	const cached = binaryCache.get(adapter);
	if (cached) return cached;

	// Prefer the PATH binary when it genuinely supports the adapter.
	if (binarySupportsAdapter('dbt', adapter)) {
		binaryCache.set(adapter, 'dbt');
		return 'dbt';
	}

	// The adapter's isolated venv (see dbt-venvs.ts) — existence is trusted
	// here; provision-time verification plus ensureDbtAdapter()'s probe below
	// keep a broken venv from silently serving bad runs.
	if (venvBinaryExists(adapter)) {
		const venvBin = venvBinary(adapter);
		binaryCache.set(adapter, venvBin);
		return venvBin;
	}

	// Otherwise scan for a legacy Python-based dbt binary that has the adapter.
	for (const candidate of candidatePythonDbtBinaries()) {
		if (fs.existsSync(candidate) && scriptSupportsAdapter(candidate, adapter)) {
			binaryCache.set(adapter, candidate);
			return candidate;
		}
	}

	// Fallback — ensureDbtAdapter() turns this into background provisioning
	// or a descriptive error.
	binaryCache.set(adapter, 'dbt');
	return 'dbt';
}

// ── Adapter provisioning (isolated venvs, never system Python) ───────────────

export interface EnsureDbtAdapterOptions {
	/**
	 * Kick off background provisioning when the venv is missing. Defaults to
	 * true; tests pass false to stay hermetic (no venv creation as a side
	 * effect — the error is still thrown and asserted).
	 */
	triggerBackgroundProvision?: boolean;
}

/**
 * Ensure the dbt binary backing this project supports its profiles.yml
 * adapter. Fast path (PATH dbt or ready venv) returns the verified binary.
 * Otherwise this never blocks on an install: it kicks off background
 * provisioning of the adapter's isolated venv (boot reconciliation usually
 * got there first) and throws a descriptive, retryable error instead.
 */
export async function ensureDbtAdapter(
	projectFolder: string,
	onProgress?: (line: string) => void,
	opts?: EnsureDbtAdapterOptions
): Promise<string> {
	const adapter = readAdapter(projectFolder);
	// Resolve fresh: background provisioning may have completed since the
	// cached fallback was stored.
	binaryCache.delete(adapter);
	const binary = resolveDbtBinary(projectFolder);
	if (binarySupportsAdapter(binary, adapter)) return binary;

	const pkg = adapterPackage(adapter);
	if (isProvisioning(adapter)) {
		throw new Error(`dbt adapter "${adapter}" is still provisioning (${pkg}); retry shortly.`);
	}
	if (opts?.triggerBackgroundProvision === false) {
		throw new Error(
			`dbt adapter "${adapter}" is not installed (${pkg} missing in ${venvBinary(adapter)}).`
		);
	}
	if (mayRetryProvision(adapter)) {
		void ensureDbtVenv(adapter, onProgress).catch(() => {
			// Failure is recorded on the adapter state for the next call to
			// report; the request itself stays fast.
		});
		throw new Error(
			`dbt adapter "${adapter}" is not installed — provisioning ${pkg} in the background; retry shortly.`
		);
	}
	throw new Error(
		`dbt adapter "${adapter}" provisioning failed recently` +
			`${lastProvisionError(adapter) ? `: ${lastProvisionError(adapter)}` : ''} — ` +
			`retry shortly; see server logs for detail.`
	);
}

/**
 * Resolve the Python interpreter backing a dbt script: read its shebang, or
 * resolve a bare name via PATH first. Returns null for compiled (non-Python)
 * binaries such as dbt-fusion.
 */
function pythonForBinary(binary: string): string | null {
	try {
		let scriptPath = binary;
		if (!binary.includes(path.sep)) {
			const resolved = execFileSync('sh', ['-c', `command -v ${binary}`], {
				timeout: 3000,
				encoding: 'utf-8'
			}).trim();
			if (!resolved) return null;
			scriptPath = resolved;
		}
		if (!fs.existsSync(scriptPath)) return null;
		const firstLine = fs.readFileSync(scriptPath, 'utf-8').slice(0, 256).split('\n')[0];
		const shebangMatch = firstLine.match(/^#!(.+)/);
		if (!shebangMatch) return null;
		const parts = shebangMatch[1].trim().split(/\s+/);
		let pythonBin = parts[0];
		// Handle `#!/usr/bin/env python3` style shebangs.
		if (pythonBin === 'env' || pythonBin.endsWith('/env')) {
			if (!parts[1]) return null;
			try {
				pythonBin = execFileSync('sh', ['-c', `command -v ${parts[1]}`], {
					timeout: 3000,
					encoding: 'utf-8'
				}).trim();
			} catch {
				return null;
			}
			if (!pythonBin) return null;
		}
		return fs.existsSync(pythonBin) ? pythonBin : null;
	} catch {
		return null;
	}
}

/** Site-packages directories visible to a Python interpreter. */
function siteDirs(pythonBin: string): string[] {
	try {
		const siteOut = execFileSync(
			pythonBin,
			[
				'-c',
				'import site,os;print(os.pathsep.join(site.getsitepackages()+[site.getusersitepackages()]))'
			],
			{ timeout: 5000, encoding: 'utf-8' }
		);
		return siteOut.trim().split(path.delimiter).filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Check whether a dbt binary can run the given adapter by looking for the
 * adapter package in its interpreter's site-packages — no dbt startup
 * overhead. Binaries with no resolvable path never support anything;
 * compiled (shebang-less) binaries fall back to the fusion set.
 */
export function binarySupportsAdapter(binary: string, adapter: string): boolean {
	const scriptPath = binary.includes(path.sep)
		? binary
		: (() => {
				try {
					return execFileSync('sh', ['-c', `command -v ${binary}`], {
						timeout: 3000,
						encoding: 'utf-8'
					}).trim();
				} catch {
					return '';
				}
			})();
	if (!scriptPath || !fs.existsSync(scriptPath)) return false;
	const pythonBin = pythonForBinary(binary);
	if (!pythonBin) return FUSION_ADAPTERS.has(adapter.toLowerCase());
	try {
		for (const sitePath of siteDirs(pythonBin)) {
			if (fs.existsSync(path.join(sitePath, 'dbt', 'adapters', adapter.toLowerCase()))) {
				return true;
			}
		}
	} catch {
		// ignore
	}
	return false;
}

/**
 * Check whether a Python dbt script (shebang-based) can run the given adapter.
 * Thin wrapper over `binarySupportsAdapter` for explicit script paths.
 */
function scriptSupportsAdapter(scriptPath: string, adapter: string): boolean {
	return binarySupportsAdapter(scriptPath, adapter);
}

/**
 * Candidate Python dbt script paths ordered from most stable to most specific.
 * These are non-dbt-fusion dbt installations that may support additional adapters.
 */
function candidatePythonDbtBinaries(): string[] {
	const home = os.homedir();
	const candidates: string[] = [];

	// macOS user-level pip installs (~/Library/Python/3.x/bin/dbt)
	const libPython = path.join(home, 'Library', 'Python');
	if (fs.existsSync(libPython)) {
		const versions = fs.readdirSync(libPython).sort().reverse();
		for (const ver of versions) {
			candidates.push(path.join(libPython, ver, 'bin', 'dbt'));
		}
	}

	// Homebrew Python bins
	for (const prefix of ['/opt/homebrew', '/usr/local']) {
		const bin = path.join(prefix, 'bin', 'dbt');
		if (fs.existsSync(bin)) candidates.push(bin);
	}

	// Common project-local virtual envs one level under home
	for (const base of [
		home,
		path.join(home, 'Documents', 'projects'),
		path.join(home, 'Documents', 'projects', 'my_proj')
	]) {
		try {
			for (const entry of fs.readdirSync(base)) {
				for (const envDir of ['env', '.venv', 'venv', '.env']) {
					candidates.push(path.join(base, entry, envDir, 'bin', 'dbt'));
				}
			}
		} catch {
			/* ignore */
		}
	}

	return candidates;
}

// ── Job management ────────────────────────────────────────────────────────────

/**
 * Spawn a dbt CLI command and return a job ID.
 * The binary is chosen based on the project's adapter type so that adapters
 * unsupported by dbt-fusion (e.g. clickhouse) use the correct python-based binary.
 * Log lines are emitted on the job's emitter as `'line'` events.
 * Completion is emitted as `'done'` with exit code.
 * NOTE: this does not provision a missing adapter — async callers should use
 * `spawnDbtAsync`, which ensures the profiles.yml adapter is installed first.
 */
export function spawnDbt(args: string[], cwd: string): string {
	assertAllowedProjectFolder(cwd);
	const id = makeId();
	const emitter = new EventEmitter();
	emitter.setMaxListeners(50);

	const binary = resolveDbtBinary(cwd);

	const proc = spawn(binary, args, {
		cwd,
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe']
	});

	const job: DbtJob = { id, process: proc, emitter, done: false, exitCode: null, lines: [] };
	jobs.set(id, job);

	function handleLine(data: Buffer): void {
		const text = data.toString();
		for (const line of text.split('\n')) {
			if (line.trim()) {
				job.lines.push(line);
				emitter.emit('line', line);
			}
		}
	}

	proc.stdout?.on('data', handleLine);
	proc.stderr?.on('data', handleLine);

	proc.on('close', (code) => {
		job.done = true;
		job.exitCode = code;
		emitter.emit('done', code);
		// Clean up after 60 seconds
		setTimeout(() => jobs.delete(id), 60_000);
	});

	proc.on('error', (err) => {
		job.done = true;
		job.exitCode = -1;
		emitter.emit('line', `Error: ${err.message}`);
		emitter.emit('done', -1);
		setTimeout(() => jobs.delete(id), 60_000);
	});

	return id;
}

export function getJob(id: string): DbtJob | undefined {
	return jobs.get(id);
}

/**
 * Ensure the project's adapter is installed, then spawn a dbt CLI command.
 * Prefer this over `spawnDbt` in async contexts — it adapts to whatever
 * database the project's profiles.yml targets (duckdb, postgres, trino, …)
 * instead of assuming the PATH `dbt` already supports it.
 */
export async function spawnDbtAsync(
	args: string[],
	cwd: string,
	onProgress?: (line: string) => void
): Promise<string> {
	assertAllowedProjectFolder(cwd);
	await ensureDbtAdapter(cwd, onProgress);
	return spawnDbt(args, cwd);
}

/**
 * Kill a running dbt job.
 */
export function killJob(id: string): void {
	const job = jobs.get(id);
	if (job && !job.done) {
		job.process.kill('SIGTERM');
	}
}
