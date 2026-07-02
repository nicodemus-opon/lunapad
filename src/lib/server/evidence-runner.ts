import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { assertAllowedProjectFolder } from './project.js';

export interface EvidenceJob {
	id: string;
	process: ChildProcess;
	emitter: EventEmitter;
	done: boolean;
	exitCode: number | null;
	lines: string[];
	port: number | null;
	folder: string;
}

const jobs = new Map<string, EvidenceJob>();
let runningJobId: string | null = null;

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

// ── Port detection ────────────────────────────────────────────────────────────

/** Parse port from Vite/Evidence startup output. */
function parsePort(line: string): number | null {
	// Matches: "Local:   http://localhost:3000/" or "➜  Local: http://localhost:3000"
	const m = line.match(/https?:\/\/localhost:(\d+)/);
	return m ? parseInt(m[1], 10) : null;
}

// ── Package manager detection ─────────────────────────────────────────────────

function detectPackageManager(folder: string): string {
	if (fs.existsSync(path.join(folder, 'pnpm-lock.yaml'))) return 'pnpm';
	if (fs.existsSync(path.join(folder, 'yarn.lock'))) return 'yarn';
	return 'npm';
}

// ── Job management ────────────────────────────────────────────────────────────

export function startEvidenceServer(folder: string): string {
	assertAllowedProjectFolder(folder);
	// Stop any existing server first
	if (runningJobId) {
		stopEvidenceServer(runningJobId);
	}

	const id = makeId();
	const emitter = new EventEmitter();
	emitter.setMaxListeners(50);

	const pm = detectPackageManager(folder);
	const [cmd, args] =
		pm === 'npm'
			? ['npm', ['run', 'dev', '--', '--host']]
			: pm === 'pnpm'
				? ['pnpm', ['dev', '--host']]
				: ['yarn', ['dev', '--host']];

	const proc = spawn(cmd, args, {
		cwd: folder,
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: process.platform === 'win32'
	});

	const job: EvidenceJob = {
		id,
		process: proc,
		emitter,
		done: false,
		exitCode: null,
		lines: [],
		port: null,
		folder
	};
	jobs.set(id, job);
	runningJobId = id;

	function handleLine(data: Buffer): void {
		const text = data.toString();
		for (const line of text.split('\n')) {
			if (!line.trim()) continue;
			job.lines.push(line);
			emitter.emit('line', line);

			// Detect port from startup output
			if (job.port === null) {
				const port = parsePort(line);
				if (port !== null) {
					job.port = port;
					emitter.emit('port', port);
				}
			}
		}
	}

	proc.stdout?.on('data', handleLine);
	proc.stderr?.on('data', handleLine);

	proc.on('close', (code) => {
		job.done = true;
		job.exitCode = code;
		if (runningJobId === id) runningJobId = null;
		emitter.emit('done', code);
		setTimeout(() => jobs.delete(id), 60_000);
	});

	proc.on('error', (err) => {
		job.done = true;
		job.exitCode = -1;
		if (runningJobId === id) runningJobId = null;
		emitter.emit('line', `Error: ${err.message}`);
		emitter.emit('done', -1);
		setTimeout(() => jobs.delete(id), 60_000);
	});

	return id;
}

export function stopEvidenceServer(jobId: string): void {
	const job = jobs.get(jobId);
	if (!job) return;
	try {
		job.process.kill('SIGTERM');
	} catch {
		// already dead
	}
	if (runningJobId === jobId) runningJobId = null;
}

export function getJob(id: string): EvidenceJob | undefined {
	return jobs.get(id);
}

export function getRunningJob(): { jobId: string; port: number | null } | null {
	if (!runningJobId) return null;
	const job = jobs.get(runningJobId);
	if (!job || job.done) return null;
	return { jobId: runningJobId, port: job.port };
}
