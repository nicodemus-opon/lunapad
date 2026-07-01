import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

/** Adapters natively supported by dbt-fusion. */
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

/** Parse the adapter type from a project's profiles.yml (first `type:` match). */
function readAdapter(projectFolder: string): string {
	try {
		const content = fs.readFileSync(path.join(projectFolder, 'profiles.yml'), 'utf-8');
		const m = content.match(/^\s+type:\s*(\w+)/m);
		return m?.[1]?.toLowerCase() ?? 'duckdb';
	} catch {
		return 'duckdb';
	}
}

/**
 * Check whether a Python dbt script (shebang-based) can run the given adapter.
 * Reads the shebang to find the interpreter, then checks the interpreter's
 * site-packages for the adapter directory — no dbt startup overhead.
 */
function scriptSupportsAdapter(scriptPath: string, adapter: string): boolean {
	try {
		const firstLine = fs.readFileSync(scriptPath, 'utf-8').slice(0, 256).split('\n')[0];
		const shebangMatch = firstLine.match(/^#!(.+)/);
		if (!shebangMatch) return false;
		const pythonBin = shebangMatch[1].trim();
		if (!fs.existsSync(pythonBin)) return false;

		// Ask the interpreter for its site-packages — fast, no dbt import.
		// Use os.pathsep to delimit so the command needs no shell escaping.
		const siteOut = execFileSync(
			pythonBin,
			[
				'-c',
				'import site,os;print(os.pathsep.join(site.getsitepackages()+[site.getusersitepackages()]))'
			],
			{ timeout: 3000, encoding: 'utf-8' }
		);
		for (const sitePath of siteOut.trim().split(path.delimiter)) {
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

/** Cache: adapter type → resolved binary path. */
const binaryCache = new Map<string, string>();

/**
 * Resolve the dbt binary for the given project folder.
 * dbt-fusion handles supported adapters directly; for others (e.g. clickhouse)
 * we scan for a Python-based dbt binary that has the adapter installed.
 */
export function resolveDbtBinary(projectFolder: string): string {
	const adapter = readAdapter(projectFolder);
	const cached = binaryCache.get(adapter);
	if (cached) return cached;

	if (FUSION_ADAPTERS.has(adapter)) {
		binaryCache.set(adapter, 'dbt');
		return 'dbt';
	}

	// Non-fusion adapter — scan candidates
	for (const candidate of candidatePythonDbtBinaries()) {
		if (fs.existsSync(candidate) && scriptSupportsAdapter(candidate, adapter)) {
			binaryCache.set(adapter, candidate);
			return candidate;
		}
	}

	// Fallback
	binaryCache.set(adapter, 'dbt');
	return 'dbt';
}

// ── Job management ────────────────────────────────────────────────────────────

/**
 * Spawn a dbt CLI command and return a job ID.
 * The binary is chosen based on the project's adapter type so that adapters
 * unsupported by dbt-fusion (e.g. clickhouse) use the correct python-based binary.
 * Log lines are emitted on the job's emitter as `'line'` events.
 * Completion is emitted as `'done'` with exit code.
 */
export function spawnDbt(args: string[], cwd: string): string {
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
 * Kill a running dbt job.
 */
export function killJob(id: string): void {
	const job = jobs.get(id);
	if (job && !job.done) {
		job.process.kill('SIGTERM');
	}
}
