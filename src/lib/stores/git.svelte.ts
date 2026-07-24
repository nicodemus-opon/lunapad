/** Shared git status, so both GitPanel and NotebookTree can read per-file
 *  status without polling the server independently. */

import { gitStatus } from '$lib/services/git-client';
import type { GitStatus, GitDisplayStatus } from '$lib/types/git';

let rawStatus = $state<GitStatus | null>(null);
let currentFolder = $state<string | null>(null);
let loading = $state(false);

export function getRawGitStatus(): GitStatus | null {
	return rawStatus;
}

export function isGitStatusLoading(): boolean {
	return loading;
}

export async function refreshGitStatus(folder: string): Promise<GitStatus | null> {
	loading = true;
	try {
		const status = await gitStatus(folder);
		currentFolder = folder;
		rawStatus = status;
		return status;
	} finally {
		loading = false;
	}
}

const statusByPath = $derived.by(() => {
	const map = new Map<string, GitDisplayStatus>();
	if (!rawStatus?.isRepo) return map;
	// Unstaged first, then staged overwrites: prefer whichever reflects the
	// working tree, since that's what "unstaged" already means here.
	for (const file of rawStatus.staged) map.set(file.path, file.status);
	for (const file of rawStatus.unstaged) map.set(file.path, file.status);
	for (const path of rawStatus.untracked) map.set(path, '?');
	return map;
});

export function getGitStatusForPath(path: string): GitDisplayStatus | undefined {
	return statusByPath.get(path);
}

/** Highest-priority status among the given paths (a notebook may back onto
 *  multiple files in 'flat' format), or undefined if none have changes. */
export function getGitStatusForPaths(paths: string[]): GitDisplayStatus | undefined {
	let best: GitDisplayStatus | undefined;
	for (const path of paths) {
		const status = statusByPath.get(path);
		if (!status) continue;
		if (!best || statusPriority(status) > statusPriority(best)) best = status;
	}
	return best;
}

function statusPriority(status: GitDisplayStatus): number {
	switch (status) {
		case 'C':
			return 5; // conflicted, if ever surfaced this way
		case 'M':
			return 4;
		case 'A':
			return 3;
		case 'R':
			return 2;
		case 'D':
			return 2;
		case '?':
			return 1;
		default:
			return 0;
	}
}

export function getCurrentGitFolder(): string | null {
	return currentFolder;
}
