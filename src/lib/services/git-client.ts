/**
 * Client-side wrappers for the /api/git/* server routes.
 * Mirrors the shape of project-client.ts's dbt* functions.
 */

import type { GitStatus, GitBranches, GitCommitLogEntry, GitRemoteInfo } from '$lib/types/git';

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
	const body = (await res.json()) as { error?: string } & T;
	if (!res.ok) throw new Error(body.error ?? fallback);
	return body;
}

export async function gitStatus(folder: string): Promise<GitStatus> {
	const res = await fetch(`/api/git/status?folder=${encodeURIComponent(folder)}`);
	return unwrap<GitStatus>(res, 'Failed to load git status');
}

export async function gitDiff(
	folder: string,
	path: string,
	opts: { staged?: boolean; untracked?: boolean } = {}
): Promise<string> {
	const params = new URLSearchParams({ folder, path });
	if (opts.staged) params.set('staged', '1');
	if (opts.untracked) params.set('untracked', '1');
	const res = await fetch(`/api/git/diff?${params.toString()}`);
	const body = await unwrap<{ diff: string }>(res, 'Failed to load diff');
	return body.diff;
}

export async function gitLog(
	folder: string,
	path?: string,
	limit = 20
): Promise<GitCommitLogEntry[]> {
	const params = new URLSearchParams({ folder, limit: String(limit) });
	if (path) params.set('path', path);
	const res = await fetch(`/api/git/log?${params.toString()}`);
	const body = await unwrap<{ commits: GitCommitLogEntry[] }>(res, 'Failed to load log');
	return body.commits;
}

export async function gitBranches(folder: string): Promise<GitBranches> {
	const res = await fetch(`/api/git/branches?folder=${encodeURIComponent(folder)}`);
	return unwrap<GitBranches>(res, 'Failed to load branches');
}

export async function gitStage(folder: string, paths: string[]): Promise<void> {
	const res = await fetch('/api/git/stage', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, paths })
	});
	await unwrap(res, 'Failed to stage files');
}

export async function gitUnstage(folder: string, paths: string[]): Promise<void> {
	const res = await fetch('/api/git/unstage', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, paths })
	});
	await unwrap(res, 'Failed to unstage files');
}

export async function gitDiscard(
	folder: string,
	paths: string[],
	untracked = false
): Promise<void> {
	const res = await fetch('/api/git/discard', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, paths, untracked })
	});
	await unwrap(res, 'Failed to discard changes');
}

export async function gitCommit(folder: string, message: string): Promise<string> {
	const res = await fetch('/api/git/commit', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, message })
	});
	const body = await unwrap<{ hash: string }>(res, 'Failed to commit');
	return body.hash;
}

export async function gitCheckout(folder: string, branch: string, create = false): Promise<void> {
	const res = await fetch('/api/git/checkout', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, branch, create })
	});
	await unwrap(res, 'Failed to switch branches');
}

export async function gitInit(folder: string): Promise<void> {
	const res = await fetch('/api/git/init', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	await unwrap(res, 'Failed to initialize repository');
}

async function submitJob(url: string, folder: string, extra: Record<string, unknown> = {}) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, ...extra })
	});
	const body = (await res.json()) as { error?: string; job?: { id: string }; jobId?: string };
	if (!res.ok) throw new Error(body.error ?? 'Git operation failed');
	// Inline adapter returns { jobId } from the run() callback's result; queue
	// adapter returns 202 with { job }. Normalize to a bare job id either way.
	return body.jobId ?? body.job?.id ?? '';
}

export function gitPush(folder: string, force = false): Promise<string> {
	return submitJob('/api/git/push', folder, { force });
}

export function gitPull(folder: string): Promise<string> {
	return submitJob('/api/git/pull', folder);
}

export function gitFetch(folder: string): Promise<string> {
	return submitJob('/api/git/fetch', folder);
}

/** Subscribe to live log output for a git job (push/pull/fetch). Returns an unsubscribe fn. */
export function watchGitLogs(
	jobId: string,
	onLine: (text: string) => void,
	onDone: (exitCode: number) => void
): () => void {
	const ctrl = new AbortController();

	(async () => {
		try {
			const res = await fetch(`/api/git/logs?jobId=${encodeURIComponent(jobId)}`, {
				signal: ctrl.signal
			});
			if (!res.body) return;
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() ?? '';
				for (const part of parts) {
					const line = part.trim();
					if (!line.startsWith('data:')) continue;
					try {
						const event = JSON.parse(line.slice(5).trim()) as {
							type: string;
							text?: string;
							exitCode?: number;
						};
						if (event.type === 'line' && event.text) onLine(event.text);
						if (event.type === 'done') onDone(event.exitCode ?? 0);
					} catch {
						// ignore
					}
				}
			}
		} catch {
			// aborted or network error — caller's onDone won't fire, which is fine
			// for an intentional unsubscribe.
		}
	})();

	return () => ctrl.abort();
}

export async function gitGetRemote(folder: string): Promise<GitRemoteInfo | null> {
	const res = await fetch(`/api/git/remote?folder=${encodeURIComponent(folder)}`);
	const body = await unwrap<{ remote: GitRemoteInfo | null }>(res, 'Failed to load remote config');
	return body.remote;
}

export async function gitSetRemote(
	folder: string,
	remoteUrl: string,
	defaultBranch = 'main'
): Promise<void> {
	const res = await fetch('/api/git/remote', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, remoteUrl, defaultBranch })
	});
	await unwrap(res, 'Failed to save remote');
}

export async function gitRemoveRemote(folder: string): Promise<void> {
	const res = await fetch('/api/git/remote', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	await unwrap(res, 'Failed to remove remote');
}

export async function gitGenerateDeployKey(folder: string): Promise<string> {
	const res = await fetch('/api/git/credentials/generate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	const body = await unwrap<{ publicKey: string }>(res, 'Failed to generate deploy key');
	return body.publicKey;
}

export async function gitSavePatCredential(
	folder: string,
	token: string,
	username?: string
): Promise<void> {
	const res = await fetch('/api/git/credentials', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder, authMethod: 'pat', token, username })
	});
	await unwrap(res, 'Failed to save credential');
}

export async function gitRemoveCredential(folder: string): Promise<void> {
	const res = await fetch('/api/git/credentials', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ folder })
	});
	await unwrap(res, 'Failed to remove credential');
}
