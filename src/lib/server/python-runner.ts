import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface PythonTable {
	rows: Record<string, unknown>[];
	columns: string[];
}

export interface PythonRunResult {
	error: string | null;
	missingModule: string | null;
	figures: string[];
	dataframe: { rows: Record<string, unknown>[]; columns: string[] } | null;
}

export interface PythonJob {
	id: string;
	emitter: EventEmitter;
	done: boolean;
	exitCode: number | null;
	lines: string[];
	result: PythonRunResult | null;
}

const jobs = new Map<string, PythonJob>();

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// ── Zero-setup interpreter resolution ────────────────────────────────────────
// Two paths, no manual install required on either:
//  1. Docker images (see Dockerfile) bake pandas/numpy/pyarrow/plotly into the
//     system python3 — if that's importable, use it directly, no bootstrap.
//  2. Otherwise, self-provision an isolated interpreter with `uv` (a single
//     static binary that fetches its own portable Python build when needed),
//     installing the curated package set into a cache-dir venv on first use.

// jedi powers Python-cell intellisense (src/lib/monaco/completions.ts /
// hover.ts) — same library IPython/Jupyter itself uses for completion, run
// against the warm worker's live namespace (see WORKER_SCRIPT below).
export const CURATED_PACKAGES = ['pandas', 'numpy', 'pyarrow', 'plotly', 'jedi'];
const LUNAPAD_HOME = path.join(os.homedir(), '.lunapad');
const UV_BIN_DIR = path.join(LUNAPAD_HOME, 'bin');
const VENV_DIR = path.join(LUNAPAD_HOME, 'python-venv');
const READY_MARKER = path.join(VENV_DIR, '.ready');

let resolvedInterpreter: string | null = null;
let interpreterKind: 'system' | 'uv' | null = null;
let resolvePromise: Promise<string> | null = null;

function venvPython(): string {
	return process.platform === 'win32'
		? path.join(VENV_DIR, 'Scripts', 'python.exe')
		: path.join(VENV_DIR, 'bin', 'python');
}

/** True if `python -c "import pandas, numpy, pyarrow, plotly"` succeeds. */
function hasCuratedPackages(pythonBin: string): boolean {
	try {
		const res = spawnSync(pythonBin, ['-c', `import ${CURATED_PACKAGES.join(', ')}`], {
			timeout: 8000
		});
		return res.status === 0;
	} catch {
		return false;
	}
}

function findUvBinary(): string | null {
	const candidates = ['uv', path.join(UV_BIN_DIR, 'uv')];
	for (const candidate of candidates) {
		try {
			const res = spawnSync(candidate, ['--version'], { timeout: 5000 });
			if (res.status === 0) return candidate;
		} catch {
			// not found, try next
		}
	}
	return null;
}

/** Installs the official static `uv` binary into UV_BIN_DIR via astral's install script. */
function installUv(): string {
	fs.mkdirSync(UV_BIN_DIR, { recursive: true });
	const res = spawnSync('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'], {
		env: { ...process.env, UV_INSTALL_DIR: UV_BIN_DIR, UV_UNMANAGED_INSTALL: UV_BIN_DIR },
		timeout: 120_000
	});
	if (res.status !== 0) {
		throw new Error(
			`Failed to install uv: ${res.stderr?.toString() ?? res.error?.message ?? 'unknown error'}`
		);
	}
	const bin = path.join(UV_BIN_DIR, 'uv');
	if (!fs.existsSync(bin)) throw new Error('uv install script ran but uv binary was not found');
	return bin;
}

function resolveUvBin(): string {
	return findUvBinary() ?? installUv();
}

/** Creates (if needed) a uv-managed venv with the curated packages installed. uv
 *  fetches its own portable CPython build automatically if none is visible, so
 *  this never depends on a pre-existing system Python. */
function provisionVenv(uvBin: string): void {
	if (!fs.existsSync(VENV_DIR)) {
		const res = spawnSync(uvBin, ['venv', VENV_DIR], { timeout: 120_000 });
		if (res.status !== 0) {
			throw new Error(`uv venv failed: ${res.stderr?.toString() ?? 'unknown error'}`);
		}
	}
	const res = spawnSync(uvBin, ['pip', 'install', '--python', venvPython(), ...CURATED_PACKAGES], {
		timeout: 300_000
	});
	if (res.status !== 0) {
		throw new Error(`uv pip install failed: ${res.stderr?.toString() ?? 'unknown error'}`);
	}
	fs.writeFileSync(READY_MARKER, new Date().toISOString());

	// Pick up any extra packages a teammate already pinned for this project
	// (see installProjectPinnedPackages) — kept separate from this function so
	// callers without a project folder open (no pins to apply) don't need one.
}

/** Resolves a Python interpreter with the curated packages importable, with no
 *  action required from the user. Result is cached for the process lifetime. */
export async function resolvePythonInterpreter(): Promise<string> {
	if (resolvedInterpreter) return resolvedInterpreter;
	if (resolvePromise) return resolvePromise;

	resolvePromise = (async () => {
		// Path 1: system python3 already has everything (true in the Docker image).
		if (hasCuratedPackages('python3')) {
			resolvedInterpreter = 'python3';
			interpreterKind = 'system';
			return resolvedInterpreter;
		}

		// Path 2: previously-provisioned uv venv.
		if (fs.existsSync(READY_MARKER) && hasCuratedPackages(venvPython())) {
			resolvedInterpreter = venvPython();
			interpreterKind = 'uv';
			return resolvedInterpreter;
		}

		// Path 3: self-provision via uv — no manual steps.
		const uvBin = resolveUvBin();
		provisionVenv(uvBin);
		resolvedInterpreter = venvPython();
		interpreterKind = 'uv';
		return resolvedInterpreter;
	})();

	try {
		return await resolvePromise;
	} finally {
		resolvePromise = null;
	}
}

/** True once an interpreter has been resolved this process — lets callers skip
 *  showing a "setting up…" message on every run, only the first. */
export function isPythonEnvReady(): boolean {
	return (
		resolvedInterpreter !== null || fs.existsSync(READY_MARKER) || hasCuratedPackages('python3')
	);
}

// ── Package management (curated set + on-demand / user-installed extras) ────

export interface InstalledPackage {
	name: string;
	version: string;
}

/** Lists packages visible to the resolved interpreter via `uv pip list`, which
 *  works whether or not `pip` itself is present inside the target env (uv venvs
 *  created without `--seed` don't ship pip). */
export function listInstalledPackages(): InstalledPackage[] {
	const pythonBin = resolvedInterpreter ?? (hasCuratedPackages('python3') ? 'python3' : null);
	if (!pythonBin) return [];
	try {
		const uvBin = resolveUvBin();
		const res = spawnSync(uvBin, ['pip', 'list', '--python', pythonBin, '--format=json'], {
			timeout: 15_000
		});
		if (res.status !== 0) return [];
		return JSON.parse(res.stdout.toString()) as InstalledPackage[];
	} catch {
		return [];
	}
}

/** Installs a package into the resolved interpreter's environment. Used by
 *  the package-management panel, the on-demand ModuleNotFoundError retry
 *  path, and project-pinned-package provisioning below. */
export function installPackage(
	name: string,
	version?: string | null
): { ok: boolean; message: string } {
	const spec = version ? `${name}==${version}` : name;
	try {
		if (interpreterKind === 'system') {
			const res = spawnSync('python3', ['-m', 'pip', 'install', '--break-system-packages', spec], {
				timeout: 120_000
			});
			if (res.status !== 0)
				return { ok: false, message: res.stderr?.toString() || `pip install ${spec} failed` };
			return { ok: true, message: `installed ${spec}` };
		}
		const uvBin = resolveUvBin();
		const res = spawnSync(uvBin, ['pip', 'install', '--python', venvPython(), spec], {
			timeout: 120_000
		});
		if (res.status !== 0)
			return { ok: false, message: res.stderr?.toString() || `uv pip install ${spec} failed` };
		return { ok: true, message: `installed ${spec}` };
	} catch (err) {
		return { ok: false, message: (err as Error).message };
	}
}

export function uninstallPackage(name: string): { ok: boolean; message: string } {
	try {
		if (interpreterKind === 'system') {
			const res = spawnSync(
				'python3',
				['-m', 'pip', 'uninstall', '-y', '--break-system-packages', name],
				{ timeout: 60_000 }
			);
			if (res.status !== 0) return { ok: false, message: res.stderr?.toString() || 'failed' };
			return { ok: true, message: `removed ${name}` };
		}
		const uvBin = resolveUvBin();
		const res = spawnSync(uvBin, ['pip', 'uninstall', '--python', venvPython(), name], {
			timeout: 60_000
		});
		if (res.status !== 0) return { ok: false, message: res.stderr?.toString() || 'failed' };
		return { ok: true, message: `removed ${name}` };
	} catch (err) {
		return { ok: false, message: (err as Error).message };
	}
}

/** Installs any packages a teammate already pinned for this project (see
 *  `.lunapad/python-packages.json`, read by the caller via
 *  `python-packages.ts`) that aren't already present in the resolved
 *  interpreter's environment. */
function installMissingPinnedPackages(pins: { name: string; version?: string | null }[]): void {
	if (pins.length === 0) return;
	const installed = new Set(listInstalledPackages().map((p) => p.name.toLowerCase()));
	for (const pin of pins) {
		if (!installed.has(pin.name.toLowerCase())) installPackage(pin.name, pin.version);
	}
}

const pinnedSyncedFolders = new Set<string>();

/** Ensures a project's pinned extra packages are installed into the managed
 *  venv, once per (server-process, project folder) — the venv itself is a
 *  single machine-wide cache shared across whatever projects get opened, so
 *  a fresh clone of *this* project still needs its pins applied even if the
 *  venv already exists from a previous project. */
export async function ensureProjectPinnedPackages(
	folder: string,
	pins: { name: string; version?: string | null }[]
): Promise<void> {
	if (pinnedSyncedFolders.has(folder)) return;
	pinnedSyncedFolders.add(folder);
	await resolvePythonInterpreter();
	installMissingPinnedPackages(pins);
}

// ── Worker protocol ───────────────────────────────────────────────────────────
// A long-lived per-notebook Python process, fed one JSON request per line on
// stdin, replying with plain print() lines (the user's own stdout/stderr,
// streamed live since the process runs with PYTHONUNBUFFERED=1) followed by
// exactly one line prefixed with RESULT_MARKER carrying the structured result.
// Module-level imports and any names a cell defines persist across requests —
// that's the actual point of "warm": no re-importing pandas every run.

const RESULT_MARKER = '__LUNAPAD_RESULT__';

const WORKER_SCRIPT = `
import ast, sys, json, traceback

import pandas as pd
try:
    import plotly.graph_objects as go
    import plotly.express as px
    go.Figure.show = lambda self, *a, **kw: None
except Exception:
    go = None
    px = None
if go is not None:
    pd.options.plotting.backend = 'plotly'
try:
    import jedi
except Exception:
    jedi = None

ns: dict = {'pd': pd, 'go': go, 'px': px}

def _compile_cell(code):
    # IPython-style: if the cell ends in a bare expression (e.g. just
    # referencing an upstream cell's name), eval that last expression so its
    # value can be picked up below, the same way a Jupyter cell auto-displays
    # its last line instead of requiring an explicit "result = ...".
    tree = ast.parse(code, mode='exec')
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(body=tree.body.pop().value)
        ast.fix_missing_locations(tree)
    exec_code = compile(tree, '<cell>', 'exec')
    eval_code = compile(last_expr, '<cell>', 'eval') if last_expr is not None else None
    return exec_code, eval_code

def run_one(req):
    code = req['code']
    for name, table in req.get('tables', {}).items():
        ns[name] = pd.DataFrame(table.get('rows', []))

    error = None
    missing_module = None
    result_df = None
    figures = []
    # ns is shared by every cell in the notebook (that's the "warm worker"
    # payoff — imports/names persist), so the result/figure search below must
    # only look at names this exec actually touched. Otherwise an empty or
    # unrelated cell would pick up a leftover DataFrame/figure from a
    # completely different cell's earlier run.
    before_ids = {name: id(value) for name, value in ns.items()}
    try:
        exec_code, eval_code = _compile_cell(code)
        exec(exec_code, ns)
        last_value = eval(eval_code, ns) if eval_code is not None else None

        touched = {
            name: value
            for name, value in ns.items()
            if name not in before_ids or id(value) != before_ids[name]
        }

        candidate = touched.get('result')
        if candidate is None and isinstance(last_value, (pd.DataFrame, pd.Series)):
            candidate = last_value
        if candidate is None:
            for value in reversed(list(touched.values())):
                if isinstance(value, (pd.DataFrame, pd.Series)):
                    candidate = value
                    break
        if isinstance(candidate, pd.Series):
            candidate = candidate.to_frame()
        if isinstance(candidate, pd.DataFrame):
            result_df = candidate

        if go is not None:
            seen = set()
            figure_candidates = list(touched.values())
            if isinstance(last_value, go.Figure):
                figure_candidates.append(last_value)
            for value in figure_candidates:
                if isinstance(value, go.Figure) and id(value) not in seen:
                    seen.add(id(value))
                    try:
                        figures.append(value.to_json())
                    except Exception:
                        pass
    except ModuleNotFoundError as e:
        error = traceback.format_exc()
        missing_module = e.name
    except Exception:
        error = traceback.format_exc()

    out = {'error': error, 'missingModule': missing_module, 'figures': figures, 'dataframe': None}
    if result_df is not None:
        out['dataframe'] = {
            'columns': [str(c) for c in result_df.columns],
            'rows': json.loads(result_df.to_json(orient='records'))
        }
    return out

# complete_one/hover_one are read-only static analysis against the live ns
# (jedi never executes the cell) — that's what makes them safe to run between
# real cell executions and what makes them see real bound DataFrames/imports
# instead of a static guess.
def complete_one(req):
    if jedi is None:
        return {'error': 'jedi not installed', 'completions': []}
    try:
        interp = jedi.Interpreter(req['code'], namespaces=[ns])
        completions = interp.complete(req.get('line', 1), req.get('column', 0))
        out = []
        for c in completions[:50]:
            try:
                doc = c.docstring(raw=True, fast=True)
            except Exception:
                doc = ''
            out.append({
                'name': c.name,
                'type': c.type,
                'detail': (c.description or '')[:200],
                'doc': (doc or '')[:500]
            })
        return {'error': None, 'completions': out}
    except Exception:
        return {'error': traceback.format_exc(), 'completions': []}

def hover_one(req):
    if jedi is None:
        return {'error': 'jedi not installed', 'hover': None}
    try:
        interp = jedi.Interpreter(req['code'], namespaces=[ns])
        helps = interp.help(req.get('line', 1), req.get('column', 0))
        if not helps:
            return {'error': None, 'hover': None}
        d = helps[0]
        try:
            doc = d.docstring(raw=True, fast=True)
        except Exception:
            doc = ''
        return {'error': None, 'hover': {'signature': d.description or d.name, 'doc': (doc or '')[:1000]}}
    except Exception:
        return {'error': traceback.format_exc(), 'hover': None}

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    rtype = req.get('type')
    try:
        if rtype == 'complete':
            out = complete_one(req)
        elif rtype == 'hover':
            out = hover_one(req)
        else:
            out = run_one(req)
    except Exception:
        out = {'error': traceback.format_exc(), 'missingModule': None, 'figures': [], 'dataframe': None}
    print('${RESULT_MARKER}' + json.dumps({'id': req['id'], **out}), flush=True)
`;

type PythonWorkerRequest =
	| { id: string; code: string; tables: Record<string, PythonTable> }
	| { id: string; type: 'complete' | 'hover'; code: string; line: number; column: number };

interface QueueItem {
	req: PythonWorkerRequest;
	jobId: string;
}

interface WorkerHandle {
	process: ChildProcess;
	queue: QueueItem[];
	pending: QueueItem | null;
	idleTimer: ReturnType<typeof setTimeout> | null;
	stdoutBuffer: string;
}

const workers = new Map<string, WorkerHandle>();
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// One-shot request/response RPCs (complete/hover) share the run-job queue —
// completions correctly queue behind an in-flight cell execution, matching a
// real kernel's busy semantics — but resolve via a plain Promise instead of
// the jobs map + SSE machinery `spawnPythonCell`/`watchPythonLogs` use.
const intelResolvers = new Map<string, (result: Record<string, unknown>) => void>();

function settleIntel(id: string, result: Record<string, unknown>): boolean {
	const resolve = intelResolvers.get(id);
	if (!resolve) return false;
	intelResolvers.delete(id);
	resolve(result);
	return true;
}

function clearIdleTimer(worker: WorkerHandle): void {
	if (worker.idleTimer) clearTimeout(worker.idleTimer);
	worker.idleTimer = null;
}

function armIdleTimer(notebookId: string, worker: WorkerHandle): void {
	clearIdleTimer(worker);
	worker.idleTimer = setTimeout(() => {
		if (workers.get(notebookId) === worker) {
			worker.process.kill();
			workers.delete(notebookId);
		}
	}, IDLE_TIMEOUT_MS);
}

function spawnWorker(notebookId: string, pythonBin: string): WorkerHandle {
	const scriptPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lunapad-py-')), 'worker.py');
	fs.writeFileSync(scriptPath, WORKER_SCRIPT);

	const proc = spawn(pythonBin, [scriptPath], {
		env: { ...process.env, PYTHONUNBUFFERED: '1' },
		stdio: ['pipe', 'pipe', 'pipe']
	});

	const worker: WorkerHandle = {
		process: proc,
		queue: [],
		pending: null,
		idleTimer: null,
		stdoutBuffer: ''
	};

	proc.stdout?.on('data', (data: Buffer) => {
		worker.stdoutBuffer += data.toString();
		const lines = worker.stdoutBuffer.split('\n');
		worker.stdoutBuffer = lines.pop() ?? '';
		for (const line of lines) handleWorkerLine(notebookId, worker, line);
	});
	proc.stderr?.on('data', (data: Buffer) => {
		const job = worker.pending ? jobs.get(worker.pending.jobId) : undefined;
		if (!job) return;
		for (const line of data.toString().split('\n')) {
			if (line.trim()) {
				job.lines.push(line);
				job.emitter.emit('line', line);
			}
		}
	});
	proc.on('exit', () => {
		if (workers.get(notebookId) === worker) workers.delete(notebookId);
		failPending(worker, 'Python worker process exited unexpectedly');
		for (const item of worker.queue) {
			if (!settleIntel(item.jobId, { error: 'Python worker process exited unexpectedly' })) {
				failJob(item.jobId, 'Python worker process exited unexpectedly');
			}
		}
		worker.queue = [];
	});

	return worker;
}

function failPending(worker: WorkerHandle, message: string): void {
	if (!worker.pending) return;
	if (!settleIntel(worker.pending.jobId, { error: message })) {
		failJob(worker.pending.jobId, message);
	}
	worker.pending = null;
}

function failJob(jobId: string, message: string): void {
	const job = jobs.get(jobId);
	if (!job || job.done) return;
	job.done = true;
	job.exitCode = -1;
	job.result = { error: message, missingModule: null, figures: [], dataframe: null };
	job.emitter.emit('done', -1);
}

function handleWorkerLine(notebookId: string, worker: WorkerHandle, line: string): void {
	if (line.startsWith(RESULT_MARKER)) {
		let parsed: { id: string } & Record<string, unknown>;
		try {
			parsed = JSON.parse(line.slice(RESULT_MARKER.length)) as { id: string } & Record<
				string,
				unknown
			>;
		} catch {
			failPending(worker, 'Failed to parse python worker result');
			pump(notebookId, worker);
			return;
		}
		const pending = worker.pending;
		worker.pending = null;
		if (pending && pending.jobId) {
			if (!settleIntel(pending.jobId, parsed)) {
				completeJob(pending.jobId, parsed as unknown as PythonRunResult);
			}
		}
		pump(notebookId, worker);
		return;
	}
	const job = worker.pending ? jobs.get(worker.pending.jobId) : undefined;
	if (job && line.trim()) {
		job.lines.push(line);
		job.emitter.emit('line', line);
	}
}

function completeJob(jobId: string, result: PythonRunResult): void {
	const job = jobs.get(jobId);
	if (!job || job.done) return;
	job.done = true;
	job.exitCode = result.error ? 1 : 0;
	job.result = result;
	job.emitter.emit('done', job.exitCode);
}

function pump(notebookId: string, worker: WorkerHandle): void {
	if (worker.pending) return;
	const next = worker.queue.shift();
	if (!next) {
		armIdleTimer(notebookId, worker);
		return;
	}
	clearIdleTimer(worker);
	worker.pending = next;
	worker.process.stdin?.write(JSON.stringify(next.req) + '\n');
}

async function getOrSpawnWorker(notebookId: string): Promise<WorkerHandle> {
	const existing = workers.get(notebookId);
	if (existing) return existing;
	const pythonBin = await resolvePythonInterpreter();
	const worker = spawnWorker(notebookId, pythonBin);
	workers.set(notebookId, worker);
	return worker;
}

/** Retries a request once after attempting to install a module the worker
 *  reported as missing, by re-enqueueing it at the front of the queue. */
function maybeRetryMissingModule(
	notebookId: string,
	worker: WorkerHandle,
	jobId: string,
	req: { id: string; code: string; tables: Record<string, PythonTable> },
	missingModule: string
): void {
	const job = jobs.get(jobId);
	if (!job) return;
	job.lines.push(`Installing missing package: ${missingModule}…`);
	job.emitter.emit('line', `Installing missing package: ${missingModule}…`);
	const install = installPackage(missingModule);
	job.lines.push(install.message);
	job.emitter.emit('line', install.message);
	if (!install.ok) {
		completeJob(jobId, {
			error: `Could not install '${missingModule}': ${install.message}`,
			missingModule,
			figures: [],
			dataframe: null
		});
		return;
	}
	// retry once, bypassing the normal queue ordering
	job.done = false;
	worker.queue.unshift({ req, jobId });
	pump(notebookId, worker);
}

/** Spawns (or reuses) a notebook's warm Python worker and runs `code` against
 *  it, returning a job ID immediately. Mirrors dbt-runner.ts's job pattern:
 *  stdout/stderr lines are emitted live on the job's emitter as 'line' events
 *  (for SSE streaming), completion as 'done' with the parsed PythonRunResult
 *  attached to the job. */
export function spawnPythonCell(
	notebookId: string,
	code: string,
	tables: Record<string, PythonTable>
): string {
	const id = makeId();
	const emitter = new EventEmitter();
	emitter.setMaxListeners(50);

	const job: PythonJob = { id, emitter, done: false, exitCode: null, lines: [], result: null };
	jobs.set(id, job);
	setTimeout(() => jobs.delete(id), 5 * 60_000);

	const req = { id, code, tables };

	getOrSpawnWorker(notebookId)
		.then((worker) => {
			if (job.done) return; // cancelled before the worker was ready
			worker.queue.push({ req, jobId: id });
			pump(notebookId, worker);

			// Hook a one-off listener that, on a missing-module result, attempts
			// the on-demand install and retries before surfacing as final.
			const onceDone = (): void => {
				const finished = jobs.get(id);
				if (finished?.result?.missingModule) {
					emitter.off('done', onceDone);
					maybeRetryMissingModule(notebookId, worker, id, req, finished.result.missingModule);
				}
			};
			emitter.once('done', onceDone);
		})
		.catch((err: Error) => {
			job.lines.push(`Error: ${err.message}`);
			job.result = { error: err.message, missingModule: null, figures: [], dataframe: null };
			job.done = true;
			job.exitCode = -1;
			emitter.emit('done', -1);
		});

	return id;
}

export function getPythonJob(id: string): PythonJob | undefined {
	return jobs.get(id);
}

/** True if a warm worker process is already running for this notebook.
 *  Does NOT spawn — callers use this to skip trial execution when the
 *  worker is cold (avoiding a 20 s timeout that would always fail). */
export function isWorkerWarm(notebookId: string): boolean {
	return workers.has(notebookId);
}

/** Runs jedi-backed completion/hover against a notebook's already-warm worker
 *  (read-only static analysis against the live `ns` — never executes the
 *  cell). Deliberately does NOT call `getOrSpawnWorker`: a completion request
 *  must never trigger a cold venv bootstrap just because the user typed in a
 *  cell that's never been run — if there's no worker yet, resolve empty. */
export async function requestPythonIntel(
	notebookId: string,
	type: 'complete' | 'hover',
	code: string,
	line: number,
	column: number
): Promise<Record<string, unknown>> {
	const worker = workers.get(notebookId);
	if (!worker) return type === 'complete' ? { completions: [] } : { hover: null };

	const id = makeId();
	const req: PythonWorkerRequest = { id, type, code, line, column };
	return new Promise((resolve) => {
		intelResolvers.set(id, resolve);
		worker.queue.push({ req, jobId: id });
		pump(notebookId, worker);
	});
}

/** Cancels a running/queued Python cell job: kills the notebook's warm worker
 *  (cheap to do — the next run transparently respawns, and interpreter
 *  resolution is cached at the module level so respawn cost is just process
 *  start + import) and settles the job directly in case it hadn't been
 *  queued onto a worker yet (e.g. still waiting on first-run provisioning). */
export function cancelPythonJob(notebookId: string, jobId: string): void {
	const worker = workers.get(notebookId);
	if (worker) {
		workers.delete(notebookId);
		failPending(worker, 'Cancelled');
		for (const item of worker.queue) failJob(item.jobId, 'Cancelled');
		worker.queue = [];
		worker.process.kill();
	}
	failJob(jobId, 'Cancelled');
}
