/** Fire-and-forget git actions shared by the command palette and keyboard
 *  shortcuts — real operations (not stubs), but without GitPanel's job-log
 *  drawer chrome; feedback is a toast. */

import { toast } from 'svelte-sonner';
import { gitStage, gitPush, gitPull, gitFetch, watchGitLogs } from '$lib/services/git-client';
import { getRawGitStatus, refreshGitStatus } from '$lib/stores/git.svelte';
import { getProjectFolder } from '$lib/stores/notebook.svelte';

function watchJob(jobId: string): Promise<number> {
	return new Promise((resolve) => {
		const unsubscribe = watchGitLogs(
			jobId,
			() => {},
			(code) => {
				unsubscribe();
				resolve(code);
			}
		);
	});
}

export async function quickStageAll(): Promise<void> {
	const folder = getProjectFolder();
	const status = getRawGitStatus();
	if (!folder || !status?.isRepo) return;
	const paths = [...status.unstaged.map((f) => f.path), ...status.untracked];
	if (paths.length === 0) {
		toast.info('Nothing to stage');
		return;
	}
	try {
		await gitStage(folder, paths);
		await refreshGitStatus(folder);
		toast.success(`Staged ${paths.length} file${paths.length === 1 ? '' : 's'}`);
	} catch (err) {
		toast.error((err as Error).message ?? 'Failed to stage files');
	}
}

export async function quickPush(): Promise<void> {
	const folder = getProjectFolder();
	if (!folder) return;
	try {
		const jobId = await gitPush(folder);
		const code = await watchJob(jobId);
		if (code === 0) toast.success('Pushed');
		else toast.error(`Push failed (exit ${code})`);
	} catch (err) {
		toast.error((err as Error).message ?? 'Push failed');
	} finally {
		await refreshGitStatus(folder);
	}
}

export async function quickPull(): Promise<void> {
	const folder = getProjectFolder();
	if (!folder) return;
	try {
		const jobId = await gitPull(folder);
		const code = await watchJob(jobId);
		if (code === 0) toast.success('Pulled');
		else toast.error(`Pull failed (exit ${code}) — check for conflicts`);
	} catch (err) {
		toast.error((err as Error).message ?? 'Pull failed');
	} finally {
		await refreshGitStatus(folder);
	}
}

export async function quickFetch(): Promise<void> {
	const folder = getProjectFolder();
	if (!folder) return;
	try {
		const jobId = await gitFetch(folder);
		await watchJob(jobId);
		toast.success('Fetched');
	} catch (err) {
		toast.error((err as Error).message ?? 'Fetch failed');
	} finally {
		await refreshGitStatus(folder);
	}
}
