export type GitFileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U';

export interface GitFileStatus {
	path: string;
	status: GitFileStatusCode;
	/** Present for renames/copies. */
	origPath?: string;
}

export interface GitStatus {
	isRepo: boolean;
	branch: string | null;
	ahead: number;
	behind: number;
	staged: GitFileStatus[];
	unstaged: GitFileStatus[];
	untracked: string[];
	conflicted: string[];
	hasRemote: boolean;
}

export interface GitBranchInfo {
	name: string;
	isRemote: boolean;
	current: boolean;
}

export interface GitBranches {
	current: string;
	branches: GitBranchInfo[];
}

export interface GitCommitLogEntry {
	hash: string;
	author: string;
	date: string;
	message: string;
}

export interface GitRemoteInfo {
	remoteUrl: string;
	defaultBranch: string;
	authMethod: 'deploy-key' | 'pat' | null;
	hasCredential: boolean;
	publicKey?: string;
}
