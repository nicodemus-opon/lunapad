import { simpleGit, type SimpleGit } from 'simple-git';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertAllowedProjectFolder } from './project.js';
import type { GitCredentialSecret } from './git-secrets.js';
import type {
	GitStatus,
	GitFileStatus,
	GitFileStatusCode,
	GitBranches,
	GitBranchInfo,
	GitCommitLogEntry
} from '$lib/types/git';

export interface GitJob {
	id: string;
	done: boolean;
	exitCode: number | null;
	lines: string[];
	emitter: EventEmitter;
}

const jobs = new Map<string, GitJob>();

function makeId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function getJob(id: string): GitJob | undefined {
	return jobs.get(id);
}

export function isGitRepo(cwd: string): boolean {
	try {
		return fs.statSync(path.join(cwd, '.git')).isDirectory();
	} catch {
		return false;
	}
}

// ── Credential injection ─────────────────────────────────────────────────────
// Secrets are written to per-invocation temp files (never passed as CLI args or
// baked into the remote URL, both of which would leak into `ps`/logs) and
// unlinked as soon as the git call finishes.

interface PreparedAuth {
	/** `git -c key=value` pairs, applied via simple-git's `addConfig()`. */
	config: Array<[string, string]>;
	env: NodeJS.ProcessEnv;
	cleanup: () => void;
}

function prepareGitAuth(credential: GitCredentialSecret | null | undefined): PreparedAuth {
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
	if (!credential) return { config: [], env, cleanup: () => {} };

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lunapad-git-'));
	const cleanup = () => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	};

	if (credential.authMethod === 'deploy-key' && credential.privateKey) {
		const keyPath = path.join(tmpDir, 'id_ed25519');
		fs.writeFileSync(
			keyPath,
			credential.privateKey.endsWith('\n') ? credential.privateKey : `${credential.privateKey}\n`,
			{ mode: 0o600 }
		);
		const knownHosts = path.join(tmpDir, 'known_hosts');
		fs.writeFileSync(knownHosts, '', { mode: 0o600 });
		const ssh = [
			'ssh',
			'-i',
			keyPath,
			'-o',
			'IdentitiesOnly=yes',
			// Trust-on-first-use against a per-invocation known_hosts file — deploy
			// keys are scoped to one repo/host, so this trades strict pinning for
			// "don't hang on an interactive prompt", not for skipping verification.
			'-o',
			'StrictHostKeyChecking=accept-new',
			'-o',
			`UserKnownHostsFile=${knownHosts}`
		].join(' ');
		return { config: [['core.sshCommand', ssh]], env, cleanup };
	}

	if (credential.authMethod === 'pat' && credential.token) {
		const askpassPath = path.join(tmpDir, 'askpass.sh');
		const username = credential.username || 'x-access-token';
		fs.writeFileSync(
			askpassPath,
			`#!/bin/sh\ncase "$1" in\n  Username*) echo '${username}' ;;\n  *) echo '${credential.token}' ;;\nesac\n`,
			{ mode: 0o700 }
		);
		env.GIT_ASKPASS = askpassPath;
		return { config: [], env, cleanup };
	}

	return { config: [], env, cleanup };
}

function buildGit(
	cwd: string,
	credential?: GitCredentialSecret | null
): { git: SimpleGit; cleanup: () => void } {
	assertAllowedProjectFolder(cwd);
	const auth = prepareGitAuth(credential);
	let git = simpleGit({ baseDir: cwd }).env(auth.env);
	for (const [key, value] of auth.config) git = git.addConfig(key, value);
	return { git, cleanup: auth.cleanup };
}

// ── Status ────────────────────────────────────────────────────────────────────

const STATUS_CODE_MAP: Record<string, GitFileStatusCode> = {
	M: 'M',
	A: 'A',
	D: 'D',
	R: 'R',
	C: 'C',
	U: 'U'
};

export async function getGitStatus(
	cwd: string,
	credential?: GitCredentialSecret | null
): Promise<Omit<GitStatus, 'isRepo' | 'hasRemote'>> {
	const { git, cleanup } = buildGit(cwd, credential);
	try {
		const result = await git.status();
		const staged: GitFileStatus[] = [];
		const unstaged: GitFileStatus[] = [];
		for (const file of result.files) {
			if (result.conflicted.includes(file.path)) continue;
			const stagedCode = STATUS_CODE_MAP[file.index];
			if (stagedCode) staged.push({ path: file.path, status: stagedCode, origPath: file.from });
			const unstagedCode = STATUS_CODE_MAP[file.working_dir];
			if (unstagedCode)
				unstaged.push({ path: file.path, status: unstagedCode, origPath: file.from });
		}
		return {
			branch: result.current,
			ahead: result.ahead,
			behind: result.behind,
			staged,
			unstaged,
			untracked: result.not_added,
			conflicted: result.conflicted
		};
	} finally {
		cleanup();
	}
}

export async function hasGitRemote(cwd: string): Promise<boolean> {
	const { git, cleanup } = buildGit(cwd);
	try {
		const remotes = await git.getRemotes();
		return remotes.length > 0;
	} finally {
		cleanup();
	}
}

// ── Diff / log / branches ─────────────────────────────────────────────────────

export async function getGitDiff(
	cwd: string,
	filePath: string,
	staged: boolean,
	credential?: GitCredentialSecret | null
): Promise<string> {
	const { git, cleanup } = buildGit(cwd, credential);
	try {
		return await git.diff([...(staged ? ['--staged'] : []), '--', filePath]);
	} finally {
		cleanup();
	}
}

export async function getGitLog(
	cwd: string,
	opts: { filePath?: string; maxCount: number }
): Promise<GitCommitLogEntry[]> {
	const { git, cleanup } = buildGit(cwd);
	try {
		const result = await git.log({ file: opts.filePath, maxCount: opts.maxCount });
		return result.all.map((c) => ({
			hash: c.hash,
			author: c.author_name,
			date: c.date,
			message: c.message
		}));
	} finally {
		cleanup();
	}
}

export async function getGitBranches(cwd: string): Promise<GitBranches> {
	const { git, cleanup } = buildGit(cwd);
	try {
		const summary = await git.branch(['-a']);
		const branches: GitBranchInfo[] = Object.values(summary.branches)
			.filter((b) => !b.name.includes('HEAD ->'))
			.map((b) => ({ name: b.name, isRemote: b.name.startsWith('remotes/'), current: b.current }));
		return { current: summary.current, branches };
	} finally {
		cleanup();
	}
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function gitAdd(cwd: string, paths: string[]): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		await git.add(paths);
	} finally {
		cleanup();
	}
}

export async function gitRestoreStaged(cwd: string, paths: string[]): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		await git.raw(['restore', '--staged', '--', ...paths]);
	} finally {
		cleanup();
	}
}

export async function gitDiscardPaths(cwd: string, paths: string[]): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		await git.checkout(['--', ...paths]);
	} finally {
		cleanup();
	}
}

export async function gitCommitChanges(cwd: string, message: string): Promise<string> {
	const { git, cleanup } = buildGit(cwd);
	try {
		const result = await git.commit(message);
		return result.commit;
	} finally {
		cleanup();
	}
}

export async function gitCheckoutBranch(
	cwd: string,
	branch: string,
	create: boolean
): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		if (create) await git.checkoutLocalBranch(branch);
		else await git.checkout(branch);
	} finally {
		cleanup();
	}
}

export async function gitInitRepo(cwd: string): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		await git.raw(['init', '-b', 'main']);
	} finally {
		cleanup();
	}
}

export async function gitSetRemoteUrl(cwd: string, url: string): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		const remotes = await git.getRemotes();
		if (remotes.some((r) => r.name === 'origin')) await git.remote(['set-url', 'origin', url]);
		else await git.addRemote('origin', url);
	} finally {
		cleanup();
	}
}

export async function gitRemoveRemoteOrigin(cwd: string): Promise<void> {
	const { git, cleanup } = buildGit(cwd);
	try {
		await git.removeRemote('origin');
	} finally {
		cleanup();
	}
}

export async function gitLsRemote(
	cwd: string,
	url: string,
	credential: GitCredentialSecret
): Promise<{ ok: boolean; message?: string }> {
	const { git, cleanup } = buildGit(cwd, credential);
	try {
		await git.listRemote([url]);
		return { ok: true };
	} catch (err) {
		return { ok: false, message: (err as Error).message };
	} finally {
		cleanup();
	}
}

// ── Async-job pattern for network-bound ops (push/pull/fetch) ───────────────
// Mirrors dbt-runner.ts's spawnDbt()/getJob() job shape; driven by simple-git's
// outputHandler (which exposes the underlying process's stdout/stderr streams)
// instead of a hand-rolled child_process.spawn call.

function startGitJob(
	kind: 'push' | 'pull' | 'fetch',
	cwd: string,
	credential: GitCredentialSecret | null | undefined,
	opts?: { force?: boolean }
): string {
	const id = makeId();
	const emitter = new EventEmitter();
	emitter.setMaxListeners(50);
	const job: GitJob = { id, done: false, exitCode: null, lines: [], emitter };
	jobs.set(id, job);

	const { git, cleanup } = buildGit(cwd, credential);
	git.outputHandler((_command, stdout, stderr) => {
		const onData = (data: Buffer) => {
			for (const line of data.toString().split('\n')) {
				if (line.trim()) {
					job.lines.push(line);
					emitter.emit('line', line);
				}
			}
		};
		stdout?.on('data', onData);
		stderr?.on('data', onData);
	});

	const finish = (code: number, errMessage?: string) => {
		if (job.done) return;
		cleanup();
		job.done = true;
		job.exitCode = code;
		if (errMessage) {
			job.lines.push(errMessage);
			emitter.emit('line', errMessage);
		}
		emitter.emit('done', code);
		setTimeout(() => jobs.delete(id), 60_000);
	};

	const task =
		kind === 'push'
			? git.push(['-u', 'origin', 'HEAD', ...(opts?.force ? ['--force-with-lease'] : [])])
			: kind === 'pull'
				? git.pull(['--no-rebase'])
				: git.fetch(['--all']);

	task.then(() => finish(0)).catch((err: Error) => finish(1, err.message));

	return id;
}

export function spawnGitPush(
	cwd: string,
	credential: GitCredentialSecret | null | undefined,
	force = false
): string {
	return startGitJob('push', cwd, credential, { force });
}

export function spawnGitPull(
	cwd: string,
	credential: GitCredentialSecret | null | undefined
): string {
	return startGitJob('pull', cwd, credential);
}

export function spawnGitFetch(
	cwd: string,
	credential: GitCredentialSecret | null | undefined
): string {
	return startGitJob('fetch', cwd, credential);
}
